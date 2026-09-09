<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

언어: [日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | **한국어**

> 이 문서는 요약본입니다. 화면별 설치 안내와 문제 해결은 [영어](docs/setup.en.md)와 [일본어](docs/setup.md)로 관리합니다.

파이널 판타지 XIV 고정 파티를 위한 포털 — **일정, 경감표, 아이템 분배, 공략 링크, 영상, 연습 기록**을 한곳에.

「한 파티 = 한 배포」를 전제로 만든 단일 테넌트 앱으로, **자신의 고정용으로 fork 해서 운영합니다**. 입구는 Discord 서버 멤버십으로 지키므로, 그 서버의 멤버만 로그인할 수 있습니다.

🔗 **데모(읽기 전용): https://demo-raid-repository.vercel.app**
실제 화면을 눌러 볼 수 있습니다. **자신의 데모를 따로 만들 필요는 없습니다.**

---

## 기능

### 일정

- **세 가지 모드**: **자체 작성**(후보 날짜 추가 → 출석 ○ × △ → 확정까지 포털 안에서 완결) / **동기화**(character-sheets 에서 가져오기) / **사용 안 함**
- 확정된 회차를 **다음 일정**으로 강조(당일에는 「시작까지 N시간 M분」)
- **정기 요일**을 정하면 후보 날짜가 그 요일에만 생성되고, 대화상자에서 **기간 × 요일 일괄 생성**도 가능. 정기 요일을 벗어난 날에는 「임시」「이번만」 배지
- ○ × △ 외에 **지각 도착 예정 / 조퇴 예정 시각**을 본인이 입력 가능(기호 옆에 `21:30〜`)
- 미입력 멤버 **자동 독촉**, 전원 입력 시 **자동 확정**(선택)
- Discord 알림 템플릿의 `{discord_relative}` / `{discord_time}` 은 읽는 사람의 시간대로 표시됨
- 날짜별 **메모**(중요도 표시). 작성자와 운영진이 수정할 수 있고, 작성자가 기록되지 않은 예전 메모는 누구나 정리할 수 있음
- **출석 요약** — 답변(○ × △)과 연습 기록의 실제 참여를 최근 90일 기준으로 대조해 어긋난 부분을 보여줌. 두 모드 모두 지원

### 콘텐츠(카테고리)

- 콘텐츠별 **상태**(미착수 / 연습 중 / 클리어 / 휴식), 드래그 정렬, Realtime 즉시 동기화
- 카드마다 **최근 8주 진행도 스파크라인**
- **난이도 라벨**과 **진행 모델**(층 / 페이즈)을 콘텐츠별로 지정 — 명칭이 발표되지 않은 신규 난이도도 운용 가능
- 카드 배경 이미지와 **보여줄 위치**까지 지정 가능

### 콘텐츠별 하위 탭

| 탭 | 내용 |
|---|---|
| **경감표** | 기존 Google 스프레드시트를 그대로 표시. **모바일은 읽기 전용 카드 뷰**로 재구성하고 「내 역할」「내 담당만」 필터 제공 |
| **아이템 분배** | 같은 시트 표시 + **이번 주 소화 체크**(화요일 17:00 JST 리셋)와 **BiS**(XivGear 임베드). 「원하는 사람」 표는 접을 수 있음 |
| **공략** | 링크 목록(제목 자동 취득 · 태그 · 읽음 표시). Google 문서/시트는 종류를 알 수 있는 카드로 표시 |
| **영상** | YouTube 썸네일 + 클릭 재생, FFLogs / XIVAnalysis 링크 |
| **매크로** | 게임 내 매크로 원탭 복사, **웨이마크 프리셋**과 **스트래티지 보드 공유 코드** |
| **연습 기록** | 아래 참조 |

### 연습 기록

FFLogs 의 풀 단위 데이터를 가져와 표시합니다.

- 총 풀 / 연습 일수 / 최대 도달 / 클리어 횟수, 일별 진행 바
- 각 풀에서 FFLogs / XIVAnalysis / 영상의 **해당 시점**으로 원클릭
- **전멸 원인**(가장 먼저 죽은 직업 ← 치명타 기술)과 무너지는 기믹 집계, **사망 직전** 상황
- 절 콘텐츠는 **페이즈별 체류 시간**과 최초 도달, 영식은 **층별 최초 클리어**
- 하루를 **풀 박스 열**로 표시(1 상자 = 1 풀, 클리어는 `✓`)
- 풀마다 **실수 메모**를 나중에 덧붙일 수 있음
- ⚠ **개인 DPS 는 저장·표시하지 않습니다.** 사망 기록도 「직업 + 기술」까지이며 플레이어 이름은 없습니다

### 내 페이지 (`/me`)

헤더의 사람 아이콘에서 열립니다. **본인 것만** 표시됩니다(운영진도 남의 행은 볼 수 없음).

- 내 직업 설정(기본값 + 콘텐츠별 덮어쓰기) — 경감표 필터에 사용됨
- **남은 BiS** 와 **학습 경로** 진행도를 바로 표시
- 출석 요약 입구

### 그 외

- **명령 팔레트**(Ctrl+K) — 콘텐츠 · 탭 · 동작을 가로질러 검색
- **Discord 자동 가져오기** — 콘텐츠별 채널 ID 를 등록하면 매일 01:00 JST 에 최근 100건에서 URL 을 추출해 해당 탭에 등록(버튼으로 즉시 실행도 가능)
- **학습 경로** — 신규 멤버용 「영상 → 산개도 → 매크로 → 경감표」 순서 체크리스트
- **테마** — 7개 확장팩 테마와 전용 배경 효과
- **5단계 색 의미 통일**(`src/lib/perf-tone.ts`) — 좋음 = emerald → lime → amber → orange → rose = 나쁨. ⚠ **색만으로 의미를 전달하지 않음**(숫자와 기호를 항상 병기)

---

## 기술

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase(Postgres + Realtime + RLS) · shadcn/ui + Base UI · Vercel(`main` 자동 배포, Cron).

**4단계 방어**: ① 프록시의 Discord OAuth 게이트 ② 페이지별 역할 제한 ③ 모든 Server Action 의 admin 확인 ④ DB 의 RLS. FFLogs 토큰은 AES-256-GCM 으로 암호화 보관합니다.

---

## 설치(요약, 20–40분)

**손으로 모으는 값은 5개뿐**입니다. 화면별 안내는 [영어 가이드](docs/setup.en.md)를 보세요.

> ⚠ fork 할 때 **저장소 이름을 반드시 변경**하세요(예: `pandora-raid`). 기본값 그대로면 다른 고정의 fork 와 구분되지 않습니다.

### 1. 값 5개 모으기(브라우저)

| # | 값 | 위치 |
|---|---|---|
| 1–3 | Supabase 의 **Project URL** / **anon** / **service_role** | [Supabase](https://supabase.com) 프로젝트 생성 → Settings → API |
| 4 | Discord **Bot 토큰** | [Developer Portal](https://discord.com/developers/applications) → Bot → Reset Token (**SERVER MEMBERS INTENT 켜기**) |
| 5 | Discord **서버 ID** | Discord(개발자 모드) → 서버 우클릭 |

브라우저에서 두 가지 더:

- Discord **OAuth2 → Redirects** 에 `https://<project ref>.supabase.co/auth/v1/callback` 추가
- Supabase **Authentication → Providers → Discord** 를 켜고 Client ID / Secret 붙여넣기

### 2. 설정과 데이터베이스(명령 한 줄)

```bash
npm install
npm run setup
```

값을 검증하면서 `.env.local` 을 작성하고, 무작위여도 되는 값은 자동 생성하고, 테이블 생성까지 안내한 뒤 마지막에 진단을 실행합니다.

### 3. 배포하고 돌아올 주소 등록

Vercel 에 배포한 뒤 **Supabase → Authentication → URL Configuration** 에 Site URL 과 Redirect URLs(`https://<도메인>/auth/callback`, `http://localhost:3000/auth/callback`)를 등록합니다. **이걸 빠뜨리면 로그인 후 돌아오지 못합니다.**

```bash
npm run doctor -- --url https://<내 도메인>
```

### 잘 안 될 때

```bash
npm run doctor
```

환경 변수, Supabase 연결, 스키마 적용, Discord 로그인 활성화, Bot 토큰과 서버 재적, **SERVER MEMBERS INTENT** 까지 실제로 호출해 확인하고, `❌` 마다 해결 방법을 알려줍니다.

---

## 로컬 개발

```bash
npm install
npm run setup   # 처음 한 번(.env.local 생성)
npm run dev
```

## 라이선스

MIT
