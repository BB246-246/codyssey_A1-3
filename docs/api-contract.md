# QuestLog AI — API 계약 (v1)

프론트엔드와 백엔드가 주고받는 데이터 형식을 정의한다.
이 문서가 확정되면 프론트와 백엔드를 서로 독립적으로 구현할 수 있다.

- 엔드포인트: `POST /api/plan`
- 구현 파일: `api/index.py` — Vercel Python 런타임이 인식하는 파일명이 정해져 있어
  `plan.py` 를 쓸 수 없다. 공개 주소는 `vercel.json` 의 rewrites 로 유지한다.
- Content-Type: `application/json`
- 인코딩: UTF-8

---

## 1. 요청 (프론트 → 백엔드)

```json
{
  "goal": "자료구조 중간고사 준비",
  "deadline": "2026-08-06",
  "dailyMinutes": 120,
  "progress": "연결 리스트까지 공부함",
  "intensity": "normal"
}
```

| 필드 | 타입 | 필수 | 제약 | 설명 |
|---|---|---|---|---|
| `goal` | string | O | 1~500자 | 달성하고 싶은 목표 |
| `deadline` | string | O | `YYYY-MM-DD`, 오늘~+30일 | 마감일 |
| `dailyMinutes` | integer | O | 10~720 | 하루 사용 가능 시간(분) |
| `progress` | string | X | 0~300자 | 현재 진행 상황 |
| `intensity` | string | O | `light` \| `normal` \| `hard` | 계획 강도 |

### 설계 노트

- **시간은 "분" 단위로 주고받는다.** UI에서는 "2시간"으로 보여주더라도 전송은 `120`.
  소수점 시간(1.5시간)에서 생기는 부동소수점 오차와 반올림 버그를 원천 차단한다.
- **오늘 날짜는 클라이언트가 보내지 않는다.** 백엔드가 서버 시각(KST)으로 계산한다.
  사용자 PC 시계가 틀려 있어도 계획이 어긋나지 않는다.
- `intensity` 값은 영문 키로 보내고, 화면 표기(여유롭게/보통/빡세게)는 프론트가 담당한다.

### intensity 의미

| 값 | 화면 표기 | 계획 성향 |
|---|---|---|
| `light` | 여유롭게 | 가용 시간의 약 60%만 사용, 퀘스트 3~4개 |
| `normal` | 보통 | 가용 시간의 약 80% 사용, 퀘스트 4~5개 |
| `hard` | 빡세게 | 가용 시간의 약 95% 사용, 퀘스트 5~6개 |

---

## 2. 성공 응답 (백엔드 → 프론트) — HTTP 200

```json
{
  "ok": true,
  "meta": {
    "today": "2026-07-30",
    "deadline": "2026-08-06",
    "remainingDays": 8,
    "dailyMinutes": 120,
    "totalBudgetMinutes": 960,
    "plannedMinutes": 690,
    "budgetStatus": "ok",
    "dayLoads": [
      { "day": 1, "date": "2026-07-30", "minutes": 90,  "status": "ok" },
      { "day": 3, "date": "2026-08-01", "minutes": 120, "status": "full" },
      { "day": 8, "date": "2026-08-06", "minutes": 120, "status": "full" }
    ],
    "generatedAt": "2026-07-30T09:12:00+09:00"
  },
  "plan": {
    "title": "자료구조 중간고사 대비",
    "summary": "연결 리스트 이후 단원을 8일에 나눠 정리하고, 마지막 이틀은 복습에 쓴다.",
    "quests": [
      {
        "id": "q1",
        "day": 1,
        "date": "2026-07-30",
        "type": "main",
        "title": "스택 개념 정리 + 문제 3개",
        "detail": "배열 구현과 연결 리스트 구현의 차이를 비교하고 예제 3개를 푼다.",
        "minutes": 90,
        "priority": "high"
      },
      {
        "id": "q2",
        "day": 2,
        "date": "2026-07-31",
        "type": "side",
        "title": "큐와 덱의 차이 표로 정리",
        "detail": "삽입/삭제 위치와 시간복잡도를 한 장 표로 만든다.",
        "minutes": 40,
        "priority": "low"
      }
    ],
    "bossFight": {
      "title": "기출문제 제한 시간 내 풀이",
      "detail": "실제 시험과 같은 시간을 재고 기출 1회분을 푼 뒤 오답만 정리한다.",
      "date": "2026-08-06",
      "day": 8,
      "minutes": 120
    },
    "checklist": [
      "오답 노트에 적은 문제를 다시 풀어봤는가",
      "각 자료구조의 시간복잡도를 안 보고 말할 수 있는가"
    ],
    "cautions": [
      "마지막 날에는 새로운 내용을 공부하지 않고 오답 복습만 한다."
    ]
  }
}
```

### 필드 정의

#### `meta` — 전부 백엔드가 계산한다 (AI는 관여하지 않음)

| 필드 | 타입 | 설명 |
|---|---|---|
| `today` | string | 서버 기준 오늘 날짜 (KST) |
| `remainingDays` | integer | 오늘 포함 마감일까지의 일수 (오늘이 마감이면 1) |
| `totalBudgetMinutes` | integer | `dailyMinutes × remainingDays` |
| `plannedMinutes` | integer | 모든 퀘스트 + 보스전 `minutes` 합계 |
| `budgetStatus` | string | `ok` \| `tight` \| `over` |
| `dayLoads` | array | 퀘스트가 배치된 날만 포함. 날짜별 소요 시간 합계 |
| `generatedAt` | string | ISO 8601 생성 시각 |

`budgetStatus` 판정:
- `over` — `plannedMinutes > totalBudgetMinutes`
- `tight` — 총량의 85% 초과
- `ok` — 그 외

`dayLoads[].status` 판정:
- `over` — 그 날 합계 > `dailyMinutes` (해당 날짜 카드에 경고 표시)
- `full` — `dailyMinutes`의 85% 초과
- `ok` — 그 외

> **왜 백엔드가 계산하는가:** LLM은 덧셈을 자주 틀린다. AI에게는 퀘스트별 `minutes`만
> 받고, 합계·초과 판정은 코드가 한다. 화면에 "시간 초과" 경고가 뜨더라도 그 판정은
> 항상 정확하다.

#### `plan.quests[]`

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | string | `q1`~`q6` | 백엔드가 부여. 프론트의 렌더링 key 겸 localStorage 저장 키 |
| `day` | integer | 1 ~ `remainingDays` | 1 = 오늘 |
| `date` | string | `YYYY-MM-DD` | 백엔드가 `day`로부터 계산 |
| `type` | string | `main` \| `side` | 아래 표 참조 |
| `title` | string | ~40자 | 카드 제목 |
| `detail` | string | ~120자 | 카드 본문 |
| `minutes` | integer | 10~480 | 예상 소요 시간 |
| `priority` | string | `high` \| `medium` \| `low` | 우선순위 배지 |

배열 길이는 **3~6개**. `day` 오름차순 정렬 후 반환한다.

#### RPG 용어 ↔ 계획상 실제 의미

용어가 장식으로만 남지 않도록, 각 타입이 실제로 다르게 동작해야 한다.

| 용어 | 스키마 표현 | 실제 의미 |
|---|---|---|
| 메인 퀘스트 | `plan.title` + `summary` | 목표 전체 (1개) |
| 오늘의 퀘스트 | `quests` 중 `day == 1` | 오늘 해야 할 것 |
| 필수 퀘스트 | `type: "main"` | 빠지면 목표 달성 불가 |
| 사이드 퀘스트 | `type: "side"` | **정말로 생략 가능해야 한다.** 시간 남을 때만 |
| 보스전 | `bossFight` | 마지막 날 최종 점검 (정확히 1개) |
| 주의사항 | `cautions` | 실패하기 쉬운 지점 경고 |

#### `plan.bossFight`

정확히 1개. `date`는 항상 마감일과 같다. `quests` 배열과 분리한 이유는
(1) 개수를 1개로 보장하고 (2) 화면에서 별도의 강조 카드로 렌더링하기 위해서다.
`plannedMinutes` 합계에는 포함된다.

#### `plan.checklist` / `plan.cautions`

- `checklist`: 2~4개. 마감 직전 스스로 점검할 질문
- `cautions`: 1~3개. 흔한 실수에 대한 경고

---

## 3. 실패 응답

모든 실패는 **동일한 형태**로 온다. 프론트는 `error.message`를 그대로 표시하면 되고,
에러 종류마다 분기하는 코드를 쓸 필요가 없다.

```json
{
  "ok": false,
  "error": {
    "code": "GOAL_TOO_LONG",
    "message": "목표는 500자 이내로 입력해 주세요.",
    "field": "goal"
  }
}
```

`field`는 입력값 문제일 때만 포함된다. 해당 입력칸에 포커스를 주는 용도.

| code | HTTP | 사용자에게 보일 메시지 | field |
|---|---|---|---|
| `EMPTY_GOAL` | 400 | 달성하고 싶은 목표를 입력해 주세요. | `goal` |
| `GOAL_TOO_LONG` | 400 | 목표는 500자 이내로 입력해 주세요. | `goal` |
| `PROGRESS_TOO_LONG` | 400 | 현재 진행 상황은 300자 이내로 입력해 주세요. | `progress` |
| `INVALID_DEADLINE` | 400 | 마감일은 오늘 이후 날짜로 선택해 주세요. | `deadline` |
| `DEADLINE_TOO_FAR` | 400 | 마감일은 오늘부터 30일 이내로 선택해 주세요. | `deadline` |
| `INVALID_TIME` | 400 | 하루 가능 시간은 10분에서 12시간 사이로 입력해 주세요. | `dailyMinutes` |
| `RATE_LIMITED` | 429 | 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요. | — |
| `AI_BAD_OUTPUT` | 502 | 계획을 정리하는 데 실패했습니다. 다시 시도해 주세요. | — |
| `AI_ERROR` | 502 | 계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요. | — |
| `AI_TIMEOUT` | 504 | 계획 생성이 지연되고 있습니다. 잠시 후 다시 시도해 주세요. | — |
| `SERVER_ERROR` | 500 | 계획 생성에 실패했습니다. 잠시 후 다시 시도해 주세요. | — |

### 설계 노트

- **입력 검증은 프론트와 백엔드 양쪽에서 한다.** 프론트 검증은 개발자 도구로 우회할 수
  있으므로, 과금이 걸린 백엔드는 자기 방어를 해야 한다.
- `DEADLINE_TOO_FAR`(30일 상한)는 품질과 비용을 동시에 지키는 장치다. 90일짜리 계획은
  응답이 길어 느려지고, 그렇게 먼 계획은 실제로 지켜지지도 않는다.
- `AI_BAD_OUTPUT`은 AI가 규격에 맞지 않는 JSON을 돌려준 경우다. **실무에서 가장 자주
  발생하는 실패**이므로 별도 코드로 둔다.
- 로딩 안내 문구("계획을 생성하고 있습니다. 최대 30초 정도 걸릴 수 있습니다.")는
  응답이 아니라 프론트가 요청 시작 시점에 자체적으로 표시한다.

---

## 4. AI가 생성하는 범위 (내부 규격)

AI 모델에게 요구하는 JSON은 위 응답의 **부분집합**이다.
아래 필드는 AI가 만들지 않는다.

| 필드 | 만드는 주체 | 이유 |
|---|---|---|
| `meta` 전체 | 백엔드 | 날짜·합계 계산은 코드가 정확하다 |
| `quests[].id` | 백엔드 | 순번 부여 |
| `quests[].date` | 백엔드 | `day`로부터 계산. **LLM은 오늘 날짜를 모른다** |
| `bossFight.date` | 백엔드 | 항상 마감일 |

AI에게 요구하는 형태:

```json
{
  "title": "...",
  "summary": "...",
  "quests": [
    { "day": 1, "type": "main", "title": "...", "detail": "...", "minutes": 90, "priority": "high" }
  ],
  "bossFight": { "title": "...", "detail": "...", "minutes": 120 },
  "checklist": ["...", "..."],
  "cautions": ["..."]
}
```

프롬프트에 반드시 주입할 값 (백엔드가 계산):
- 오늘 날짜, 마감일, **남은 일수(정수)**
- 하루 가능 시간(분), 총 가용 시간(분)
- `intensity`에 따른 목표 퀘스트 개수와 시간 사용 비율

### 백엔드의 출력 검증 (AI 응답 → 클라이언트 응답 사이)

AI 응답을 그대로 믿지 않는다. 아래를 통과하지 못하면 `AI_BAD_OUTPUT`.

1. JSON 파싱 성공 여부
2. 필수 필드 존재 여부
3. `quests` 길이 3~6
4. 모든 `day`가 1 이상 `remainingDays` 이하
5. `type` / `priority` 값이 허용된 문자열인지
6. `minutes`가 정수이고 범위 내인지

검증을 통과했지만 시간 예산을 초과한 경우는 **에러가 아니다.**
`budgetStatus: "over"`로 표시해 사용자에게 경고만 보여준다.
(계획 자체는 쓸모가 있고, 조정은 사용자가 판단할 몫이다.)

---

## 5. 프론트엔드 렌더링 계약

- `quests`를 `date` 기준으로 묶어 타임라인으로 표시한다. **묶는 작업은 프론트의 몫**이며,
  백엔드는 평평한 배열만 보낸다.
- `type: "side"`는 시각적으로 명확히 부차적으로 보여야 한다 (흐린 테두리, 작은 카드 등).
- `meta.dayLoads[].status`가 `over`인 날짜에는 경고 배지를 붙인다.
- 각 퀘스트 카드에 체크박스를 두고, 체크 상태를 `id` 기준으로 `localStorage`에 저장한다.
  체크된 비율이 곧 경험치(XP) 바가 된다. **DB 없이 실제로 동작하는 진행도**이며,
  장식용 가짜 게이지를 쓰지 않는다.
