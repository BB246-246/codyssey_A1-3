# QuestLog AI

목표와 마감일을 입력하면 AI가 RPG 퀘스트 형식의 실행 계획으로 바꿔 주는 웹 서비스입니다.

> **현재 상태: Phase 2 (뼈대 + 목 응답)**
> 백엔드는 아직 AI를 호출하지 않고 고정된 예시 계획을 돌려줍니다.
> 입력 검증 · 날짜 계산 · 시간 예산 판정은 실제 로직으로 동작합니다.

## 배포 URL

_(Vercel 연동 후 기재)_

## 주요 기능

- **퀘스트 생성** — 목표, 마감일, 하루 가능 시간, 진행 상황, 계획 강도를 입력하면
  남은 기간에 맞춰 퀘스트 3~6개를 날짜별로 배치한 계획을 생성합니다.
- **시간 예산 경고** — 계획된 총 시간이 실제 가용 시간을 넘으면 경고를 표시합니다.
  합계 계산은 AI가 아니라 백엔드가 하므로 항상 정확합니다.
- **실패 처리** — 빈 입력, 길이 초과, 잘못된 마감일, API 오류, 응답 지연을
  각각 구분된 안내 문구로 알려 줍니다.

## 페이지 구성

| 경로 | 내용 |
|---|---|
| `/index.html` | 서비스 소개, 사용 방법, 결과 예시 |
| `/planner.html` | 입력 폼과 AI 계획 생성 결과 |
| `/guide.html` | 좋은 목표 작성법, 결과 활용법, AI 한계 안내, FAQ |

## 기술 스택

- **프론트엔드** — HTML / CSS / JavaScript (프레임워크 미사용)
- **백엔드** — Vercel Serverless Functions (Python, 표준 라이브러리)
- **배포** — Vercel (GitHub 연동 자동 배포)

## 프로젝트 구조

```
├── index.html            # 홈
├── planner.html          # 퀘스트 생성
├── guide.html            # 모험가 가이드
├── css/style.css
├── js/planner.js         # 폼 검증 · fetch · 결과 표시
├── api/index.py          # POST /api/plan
├── docs/api-contract.md  # 프론트/백엔드 간 API 계약
├── requirements.txt
├── vercel.json           # 함수 실행 시간 · /api/plan rewrite
└── .env.example
```

## 로컬 실행

Vercel CLI를 사용하면 프론트와 `api/` 함수를 함께 띄울 수 있습니다.

```bash
npm i -g vercel
vercel dev
```

`http://localhost:3000` 에서 확인합니다.

정적 파일만 확인할 때는 아래로도 열 수 있지만, 이 경우 `/api/plan` 호출은 실패합니다.

```bash
python -m http.server 3000
```

## 환경 변수

API 키는 **코드에 직접 쓰지 않고 환경 변수로만** 관리합니다.

| 이름 | 설명 | 필요 시점 |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI API 호출용 키 | Phase 4부터 |

**로컬 설정**

```bash
cp .env.example .env
# .env 파일을 열어 실제 키를 입력
```

`.env` 는 `.gitignore` 에 등록되어 있어 커밋되지 않습니다.

**Vercel 설정**

Vercel 대시보드 → 프로젝트 → Settings → Environment Variables 에서
같은 이름으로 값을 등록한 뒤 재배포합니다.

> 키가 저장소나 스크린샷에 노출되었다면 즉시 폐기하고 재발급해야 합니다.

## API

`POST /api/plan` — 요청/응답 형식은 [docs/api-contract.md](docs/api-contract.md) 참조.

성공과 실패 모두 JSON으로 응답하며, 실패 시 `error.message` 를 그대로 사용자에게
보여줄 수 있는 형태로 내려줍니다.
