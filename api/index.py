"""
QuestLog AI — 계획 생성 엔드포인트

POST /api/plan
요청/응답 형식은 docs/api-contract.md 를 따른다.

파일 이름이 index.py 인 이유:
Vercel의 Python 런타임은 엔트리포인트를 정해진 파일명에서만 찾는다.
(app.py, index.py, server.py, main.py, wsgi.py, asgi.py)
plan.py 로 두면 "No python entrypoint found in default locations" 로 빌드가 실패한다.
공개 주소 /api/plan 은 vercel.json 의 rewrites 로 유지한다.

Phase 2에서는 AI를 호출하지 않고 generate_draft() 가 고정된 예시를 돌려준다.
검증, 날짜 계산, 시간 예산 판정은 모두 실제 로직이며 Phase 4에서도 그대로 쓴다.
"""

import json
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler

KST = timezone(timedelta(hours=9))

# ── 입력 제약 ────────────────────────────────────────────────
GOAL_MAX = 500
PROGRESS_MAX = 300
DAILY_MINUTES_MIN = 10
DAILY_MINUTES_MAX = 720
DEADLINE_MAX_DAYS = 30

# ── AI 출력 제약 ─────────────────────────────────────────────
QUEST_COUNT_MIN = 3
QUEST_COUNT_MAX = 6
QUEST_MINUTES_MIN = 10
QUEST_MINUTES_MAX = 480

INTENSITIES = ("light", "normal", "hard")
QUEST_TYPES = ("main", "side")
PRIORITIES = ("high", "medium", "low")

# code -> (HTTP status, 사용자에게 보일 메시지, 관련 입력 필드)
ERRORS = {
    "EMPTY_GOAL": (400, "달성하고 싶은 목표를 입력해 주세요.", "goal"),
    "GOAL_TOO_LONG": (400, "목표는 500자 이내로 입력해 주세요.", "goal"),
    "PROGRESS_TOO_LONG": (400, "현재 진행 상황은 300자 이내로 입력해 주세요.", "progress"),
    "INVALID_DEADLINE": (400, "마감일은 오늘 이후 날짜로 선택해 주세요.", "deadline"),
    "DEADLINE_TOO_FAR": (400, "마감일은 오늘부터 30일 이내로 선택해 주세요.", "deadline"),
    "INVALID_TIME": (400, "하루 가능 시간은 10분에서 12시간 사이로 입력해 주세요.", "dailyMinutes"),
    "INVALID_INTENSITY": (400, "계획 강도를 선택해 주세요.", "intensity"),
    "BAD_REQUEST": (400, "요청 형식이 올바르지 않습니다.", None),
    "RATE_LIMITED": (429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", None),
    "AI_BAD_OUTPUT": (502, "계획을 정리하는 데 실패했습니다. 다시 시도해 주세요.", None),
    "AI_ERROR": (502, "계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.", None),
    "AI_TIMEOUT": (504, "계획 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.", None),
    "SERVER_ERROR": (500, "계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.", None),
}


class ApiError(Exception):
    """사용자에게 보여줄 메시지가 정해진 오류."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code
        self.status, self.message, self.field = ERRORS.get(code, ERRORS["SERVER_ERROR"])


# ── 1. 입력 검증 ─────────────────────────────────────────────
# 프론트에서도 같은 검증을 하지만, 개발자 도구로 우회할 수 있으므로
# 과금이 걸린 백엔드는 반드시 스스로 검증한다.

def parse_request(body, today):
    if not isinstance(body, dict):
        raise ApiError("BAD_REQUEST")

    goal = (body.get("goal") or "").strip()
    if not goal:
        raise ApiError("EMPTY_GOAL")
    if len(goal) > GOAL_MAX:
        raise ApiError("GOAL_TOO_LONG")

    progress = (body.get("progress") or "").strip()
    if len(progress) > PROGRESS_MAX:
        raise ApiError("PROGRESS_TOO_LONG")

    try:
        deadline = datetime.strptime(body.get("deadline", ""), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ApiError("INVALID_DEADLINE")

    # 오늘 포함 남은 일수. 오늘이 마감이면 1.
    remaining_days = (deadline - today).days + 1
    if remaining_days < 1:
        raise ApiError("INVALID_DEADLINE")
    if remaining_days > DEADLINE_MAX_DAYS:
        raise ApiError("DEADLINE_TOO_FAR")

    daily_minutes = body.get("dailyMinutes")
    if isinstance(daily_minutes, bool) or not isinstance(daily_minutes, int):
        raise ApiError("INVALID_TIME")
    if not DAILY_MINUTES_MIN <= daily_minutes <= DAILY_MINUTES_MAX:
        raise ApiError("INVALID_TIME")

    intensity = body.get("intensity")
    if intensity not in INTENSITIES:
        raise ApiError("INVALID_INTENSITY")

    return {
        "goal": goal,
        "progress": progress,
        "deadline": deadline,
        "remainingDays": remaining_days,
        "dailyMinutes": daily_minutes,
        "intensity": intensity,
    }


# ── 2. 계획 초안 생성 ────────────────────────────────────────
# Phase 4에서 이 함수 하나만 AI 호출로 교체한다.
# 반환 형태는 docs/api-contract.md "4. AI가 생성하는 범위" 와 동일하다.
# 여기서 만드는 값에 날짜·id·합계는 포함되지 않는다. 그건 아래에서 코드가 계산한다.

_DRAFT_QUESTS = [
    {
        "type": "main",
        "title": "스택 개념 정리 + 문제 3개",
        "detail": "배열 구현과 연결 리스트 구현의 차이를 비교하고 예제 3개를 푼다.",
        "minutes": 90,
        "priority": "high",
    },
    {
        "type": "side",
        "title": "큐와 덱의 차이 표로 정리",
        "detail": "삽입/삭제 위치와 시간복잡도를 한 장의 표로 만든다.",
        "minutes": 40,
        "priority": "low",
    },
    {
        "type": "main",
        "title": "트리 순회 4가지 직접 구현",
        "detail": "전위·중위·후위·레벨 순회를 보지 않고 코드로 작성해 본다.",
        "minutes": 110,
        "priority": "high",
    },
    {
        "type": "main",
        "title": "정렬 알고리즘 시간복잡도 암기",
        "detail": "최선/평균/최악을 표로 만들고 빈 칸 채우기로 자가 점검한다.",
        "minutes": 80,
        "priority": "medium",
    },
    {
        "type": "side",
        "title": "헷갈린 개념만 모아 한 장 요약",
        "detail": "그동안 오답이 났던 개념만 A4 한 장으로 압축한다.",
        "minutes": 50,
        "priority": "low",
    },
]


def generate_draft(request):
    """계획 초안을 만든다. Phase 4에서 AI 호출로 교체될 지점."""
    remaining = request["remainingDays"]

    # 보스전은 마지막 날에 두므로, 일반 퀘스트는 그 앞 구간에 배치한다.
    last_quest_day = max(1, remaining - 1)
    quests = []
    for i, base in enumerate(_DRAFT_QUESTS):
        quest = dict(base)
        if len(_DRAFT_QUESTS) == 1:
            quest["day"] = 1
        else:
            spread = i * (last_quest_day - 1) / (len(_DRAFT_QUESTS) - 1)
            quest["day"] = 1 + round(spread)
        quests.append(quest)

    return {
        "title": "자료구조 중간고사 대비",
        "summary": (
            "남은 기간을 개념 정리와 문제 풀이로 나누고, 마지막 날은 "
            "새 내용 없이 복습과 실전 점검에만 쓴다."
        ),
        "quests": quests,
        "bossFight": {
            "title": "기출문제 제한 시간 내 풀이",
            "detail": "실제 시험과 같은 시간을 재고 기출 1회분을 푼 뒤 오답만 정리한다.",
            "minutes": 120,
        },
        "checklist": [
            "오답 노트에 적은 문제를 다시 풀어봤는가",
            "각 자료구조의 시간복잡도를 안 보고 말할 수 있는가",
        ],
        "cautions": [
            "마지막 날에는 새로운 내용을 공부하지 않고 오답 복습만 한다.",
        ],
    }


# ── 3. 초안 검증 ─────────────────────────────────────────────
# AI 응답을 그대로 믿지 않는다. 규격을 벗어나면 AI_BAD_OUTPUT.

def _check_text(value, label_required=True):
    return isinstance(value, str) and (bool(value.strip()) or not label_required)


def _check_minutes(value):
    if isinstance(value, bool) or not isinstance(value, int):
        return False
    return QUEST_MINUTES_MIN <= value <= QUEST_MINUTES_MAX


def validate_draft(draft, remaining_days):
    if not isinstance(draft, dict):
        raise ApiError("AI_BAD_OUTPUT")

    for key in ("title", "summary"):
        if not _check_text(draft.get(key)):
            raise ApiError("AI_BAD_OUTPUT")

    quests = draft.get("quests")
    if not isinstance(quests, list):
        raise ApiError("AI_BAD_OUTPUT")
    if not QUEST_COUNT_MIN <= len(quests) <= QUEST_COUNT_MAX:
        raise ApiError("AI_BAD_OUTPUT")

    for quest in quests:
        if not isinstance(quest, dict):
            raise ApiError("AI_BAD_OUTPUT")
        if not _check_text(quest.get("title")) or not _check_text(quest.get("detail")):
            raise ApiError("AI_BAD_OUTPUT")
        if quest.get("type") not in QUEST_TYPES:
            raise ApiError("AI_BAD_OUTPUT")
        if quest.get("priority") not in PRIORITIES:
            raise ApiError("AI_BAD_OUTPUT")
        if not _check_minutes(quest.get("minutes")):
            raise ApiError("AI_BAD_OUTPUT")
        day = quest.get("day")
        if isinstance(day, bool) or not isinstance(day, int):
            raise ApiError("AI_BAD_OUTPUT")
        if not 1 <= day <= remaining_days:
            raise ApiError("AI_BAD_OUTPUT")

    boss = draft.get("bossFight")
    if not isinstance(boss, dict):
        raise ApiError("AI_BAD_OUTPUT")
    if not _check_text(boss.get("title")) or not _check_text(boss.get("detail")):
        raise ApiError("AI_BAD_OUTPUT")
    if not _check_minutes(boss.get("minutes")):
        raise ApiError("AI_BAD_OUTPUT")

    checklist = draft.get("checklist")
    cautions = draft.get("cautions")
    for items, low, high in ((checklist, 2, 4), (cautions, 1, 3)):
        if not isinstance(items, list) or not low <= len(items) <= high:
            raise ApiError("AI_BAD_OUTPUT")
        if not all(_check_text(item) for item in items):
            raise ApiError("AI_BAD_OUTPUT")


# ── 4. 응답 조립 ─────────────────────────────────────────────
# 날짜·id·시간 합계는 전부 여기서 계산한다.
# LLM은 오늘 날짜를 모르고 덧셈도 자주 틀리므로 초안에 맡기지 않는다.

def build_response(draft, request, today, generated_at):
    remaining_days = request["remainingDays"]
    daily_minutes = request["dailyMinutes"]

    quests = sorted(draft["quests"], key=lambda q: q["day"])
    built_quests = []
    for index, quest in enumerate(quests, start=1):
        day = quest["day"]
        built_quests.append({
            "id": "q%d" % index,
            "day": day,
            "date": (today + timedelta(days=day - 1)).isoformat(),
            "type": quest["type"],
            "title": quest["title"].strip(),
            "detail": quest["detail"].strip(),
            "minutes": quest["minutes"],
            "priority": quest["priority"],
        })

    boss = draft["bossFight"]
    boss_built = {
        "title": boss["title"].strip(),
        "detail": boss["detail"].strip(),
        "date": request["deadline"].isoformat(),
        "day": remaining_days,
        "minutes": boss["minutes"],
    }

    # 날짜별 소요 시간 — 보스전 포함
    per_day = {}
    for quest in built_quests:
        per_day[quest["day"]] = per_day.get(quest["day"], 0) + quest["minutes"]
    per_day[remaining_days] = per_day.get(remaining_days, 0) + boss_built["minutes"]

    day_loads = []
    for day in sorted(per_day):
        minutes = per_day[day]
        day_loads.append({
            "day": day,
            "date": (today + timedelta(days=day - 1)).isoformat(),
            "minutes": minutes,
            "status": _load_status(minutes, daily_minutes),
        })

    planned = sum(per_day.values())
    total_budget = daily_minutes * remaining_days

    return {
        "ok": True,
        "meta": {
            "today": today.isoformat(),
            "deadline": request["deadline"].isoformat(),
            "remainingDays": remaining_days,
            "dailyMinutes": daily_minutes,
            "totalBudgetMinutes": total_budget,
            "plannedMinutes": planned,
            "budgetStatus": _load_status(planned, total_budget),
            "dayLoads": day_loads,
            "generatedAt": generated_at.isoformat(),
        },
        "plan": {
            "title": draft["title"].strip(),
            "summary": draft["summary"].strip(),
            "quests": built_quests,
            "bossFight": boss_built,
            "checklist": [item.strip() for item in draft["checklist"]],
            "cautions": [item.strip() for item in draft["cautions"]],
        },
    }


def _load_status(used, budget):
    """시간 예산 대비 상태. 초과는 오류가 아니라 경고로만 표시한다."""
    if budget <= 0:
        return "over"
    if used > budget:
        return "over"
    if used > budget * 0.85:
        return "full" if budget else "over"
    return "ok"


# ── 5. 요청 처리 ─────────────────────────────────────────────

def create_plan(body):
    now = datetime.now(KST)
    today = now.date()

    request = parse_request(body, today)
    draft = generate_draft(request)
    validate_draft(draft, request["remainingDays"])
    return build_response(draft, request, today, now)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                raise ApiError("BAD_REQUEST")
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ApiError("BAD_REQUEST")

            self._send(200, create_plan(body))

        except ApiError as err:
            payload = {"ok": False, "error": {"code": err.code, "message": err.message}}
            if err.field:
                payload["error"]["field"] = err.field
            self._send(err.status, payload)

        except Exception:
            err = ApiError("SERVER_ERROR")
            self._send(err.status, {
                "ok": False,
                "error": {"code": err.code, "message": err.message},
            })

    def do_GET(self):
        err = ApiError("BAD_REQUEST")
        self._send(405, {
            "ok": False,
            "error": {"code": "BAD_REQUEST", "message": err.message},
        })

    def _send(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass
