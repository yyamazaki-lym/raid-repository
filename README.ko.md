<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-wordmark-dark.svg">
    <img src="public/brand/logo-wordmark-light.svg" alt="Raid Repository" width="480">
  </picture>
</p>

# Raid Repository

언어: [日本語](README.md) | [English](README.en.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [简体中文](README.zh-CN.md) | **한국어**

> 이 문서는 기능과 설치를 간략히 정리한 것입니다. 전체 단계별 가이드(환경 변수, 문제 해결)는 [영어](README.en.md)와 [일본어](README.md)로 관리합니다.

파이널 판타지 XIV 고정 파티(레이드 공대)를 위한 포털: 일정, 경감표, 아이템 분배, 공략 링크, 영상, 연습 기록을 한곳에.

「한 파티 = 한 배포」를 전제로 만든 단일 테넌트 앱으로, 자신의 고정 파티용으로 fork 해서 운영합니다.

## 라이브 데모

공개 읽기 전용 데모 사이트: 🔗 **https://demo-raid-repository.vercel.app**

## 기능

### 일정
- 세 가지 소스 모드: **동기화**(character-sheets 에서 가져오기), **자체 작성**(후보 날짜 추가, 출석 ○ × △ 입력, 확정까지 포털 안에서 완결. FFLogs 연동 + Discord 알림), **사용 안 함**
- 확정된 회차를 **다음 일정**으로 강조(당일에는 「시작까지 N시간 M분」 카운트다운)
- 자체 작성 모드에서는 ○ × △ 외에 **지각 도착 예정 / 조퇴 예정 시각**(HH:MM)을 본인이 입력 가능. 기호 옆에 `21:30〜`로 표시되고 Discord 확정 알림에도 이름 옆에 표시
- Discord 알림 템플릿에서 `{discord_relative}` / `{discord_time}` 사용 가능(읽는 사람의 시간대로 「3시간 후」 등으로 렌더링)
- 미입력 멤버에게 자동 @멘션 독촉, 전원 입력 시 자동 확정(선택)
- 멤버 이름에 마우스 오버 / 탭으로 한 줄 코멘트, 회차별 Google 캘린더 링크

### 콘텐츠(카테고리)
- 레이드 콘텐츠별 **상태**(미착수 / 연습 중 / 클리어 / 휴식), 드래그 정렬, 편집 대화상자, Supabase Realtime 으로 즉시 동기화

### 콘텐츠별 하위 탭
- **경감표 / 아이템 분배**: 기존 Google 스프레드시트를 iframe 으로 표시. **모바일은 읽기 전용 카드 뷰**(시트를 CSV 로 읽어 페이즈별 카드로 재구성, 「내 담당만」 필터). 분배 탭에는 **이번 주 소화 체크**(화요일 17:00 JST 리셋)와 **BiS 링크**(XivGear 임베드)
- **공략**: 링크 목록, 제목 자동 취득. **영상**: YouTube 썸네일 + 클릭 재생(lazy embed), FFLogs / XIVAnalysis 링크 선택 가능
- **매크로**: 게임 내 매크로 원탭 복사. 같은 탭에 **웨이마크 프리셋**(markercode)과 **스트래티지 보드 공유 코드** 보관
- **연습 기록**: FFLogs 의 풀 단위 데이터를 가져와 표시 — 총 풀 / 연습 일수 / 최대 도달 / 클리어 횟수, 일별 진행 바, 각 풀에서 FFLogs / XIVAnalysis / 영상의 해당 시점으로 원클릭. 각 풀에 **전멸 원인**(가장 먼저 죽은 직업 ← 치명타 기술, 10초 이내 사망 수)과 어떤 기믹에서 무너지는지 집계. 절 콘텐츠는 **페이즈별 체류 시간**. 개인 DPS 는 저장·표시하지 않으며 사망 기록에도 플레이어 이름은 없음(직업 + 기술까지)

### Discord 자동 가져오기
- 콘텐츠별 「공략 채널 ID」「영상 채널 ID」. Vercel Cron 이 매일 01:00 JST 에 각 채널 최근 100건에서 URL 추출 → 중복 제거 → 해당 탭에 자동 등록. 버튼으로 즉시 실행도 가능

### 테마와 색
- 7개 확장팩 테마(신생 ~ Evercold), 각각 전용 배경 효과
- **5단계 색 의미**(`src/lib/perf-tone.ts`): 좋음 = emerald → lime → amber → orange → rose = 나쁨. 남은 HP%, 사망 수, 진행 바, 출석 기호, 주간 체크에 동일하게 적용. 숫자와 기호를 항상 함께 표시해 색만으로 의미를 전달하지 않음

## 기술

Next.js 16 + React 19 + Tailwind CSS v4 · Supabase(Postgres + Realtime, RLS) · shadcn/ui + Base UI · Vercel(`main` 자동 배포, Cron Jobs). 4단계 방어: 프록시의 Discord OAuth 게이트, 페이지별 역할 제한, 모든 Server Action 의 admin 확인, DB 의 RLS. FFLogs 토큰은 AES-256-GCM 으로 암호화 보관.

## 설치(요약, 30–60분)

GitHub, Supabase(무료), Vercel(Hobby), Discord Developer Portal 계정이 필요합니다.

1. 이 저장소를 **Fork** — 저장소 이름을 반드시 변경(예: `pandora-raid`)
2. **Supabase 프로젝트** 생성, SQL Editor 에서 `supabase/schema.sql` 실행, Project URL / anon key / service_role key 기록
3. **Discord Application + Bot** 생성: Client ID / Client Secret, Bot Token(SERVER MEMBERS INTENT 와 MESSAGE CONTENT INTENT 켜기), 서버 ID(Guild ID)
4. **Discord ↔ Supabase 연결**: Discord 에 redirect `https://<프로젝트>.supabase.co/auth/v1/callback` 추가, Supabase 에서 Discord provider 활성화 후 Client ID / Secret 입력
5. **Vercel 배포**: 환경 변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`(선택: `DISCORD_ADMIN_ROLE_IDS`, `CRON_SECRET`, `FFLOGS_API_KEY`, FFLogs OAuth, `SECRET_ENCRYPTION_KEY`, `YOUTUBE_API_KEY`)
6. **Bot 초대**(scope `bot`, 권한 View Channels / Read Message History)
7. **Supabase URL Configuration**: Site URL = Vercel 도메인, Redirect URLs 에 `https://<도메인>/auth/callback` 과 `http://localhost:3000/auth/callback`
8. **초기 설정**: 일정 소스 선택, 콘텐츠 추가, 시트 URL 입력
9. *(선택)* Discord 가져오기용 채널 ID 등록, Bot 에 채널별 읽기 권한 부여
10. *(선택)* GitHub Secret `SUPABASE_DB_URL`(Session pooler) 등록으로 `schema.sql` 을 GitHub Actions 가 자동 반영

각 단계의 상세, 문제 해결, 스키마 업데이트: [영어 가이드](README.en.md#setup-for-your-raid-group).

## 로컬 개발

```bash
npm install
cp .env.local.example .env.local  # Supabase 키 입력
npm run dev
```

## 라이선스

MIT
