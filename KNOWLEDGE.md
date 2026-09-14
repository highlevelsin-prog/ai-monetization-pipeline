# KNOWLEDGE.md — AI 수익 자동화 파이프라인 구조 요약

> AI는 코드를 파악할 때 이 파일을 **먼저** 읽고, 관련 파일만 선별해서 열 것.
> (전체 파일을 순차 탐색하지 말 것)

## 한눈에 보는 데이터 흐름

```
[클라우드] GitHub Actions (.github/workflows/blog-generator.yml)
  blogGenerator.js  →  워드프레스(cheetahfather.wordpress.com) 발행
        ▲ (로컬에서 triggerGenerate.js로도 트리거)
        │
[로컬 PC] 작업 스케줄러 "TistoryMirror" → pipeline.bat (매일 09:15/12:15/15:15)
  1) triggerGenerate.js  → 클라우드 글 생성 트리거 + 실행 완료까지 대기(최대 10분, 실패 시 알림)
  2) (20초 대기 — WP REST 반영)
  3) tistoryMirror.js    → 워드프레스 최신글 20개 확인, 미발행 글을 오래된 순으로 처리
       ├─ wpPosts.js   : 워드프레스 글 조회 (사이트 비공개 → .wp-config.json 계정으로 XML-RPC)
       ├─ tistory.js   : 티스토리(ddr5558.tistory.com) **비공개** 발행 (Whale 9222 connect)
       ├─ shorts.js    : 유튜브 쇼츠 대본 생성 → 프로젝트\쇼츠대본\*.txt
       └─ alert.js     : 실패 알림 → 슬랙 #파이프라인 + 네이버 메일
  실행 로그: logs/pipeline.log
```

## 파일별 역할 (핵심 함수)

| 파일 | 역할 | 핵심 함수 |
|------|------|-----------|
| `blogGenerator.js` | (클라우드) 뉴스→OpenAI(gpt-5.4) 기사 생성→이미지 삽입(영어 IMAGE 키워드)→워드프레스 발행. `DRY_RUN=1`이면 발행 생략 | getTrendingTopics, generateBlogPost, searchImage, insertImages, postToWordPress, main |
| `newsSources.js` | 뉴스 소재 공급. kr=국내 증권 RSS / us=NewsAPI (워크플로 입력 source) | pickTopic |
| `tistory.js` | 티스토리 발행 공유 모듈. Whale 자동실행·로그인확인·제목40자축약·본문/태그입력·발행·발행확인, RSS 중복확인 | ensureWhaleRunning, postToTistory, shortenTitle, isOnTistory |
| `tistoryMirror.js` | (로컬) 워드프레스 최신글 미러링 + 쇼츠생성 + 세션알림. 중복방지(mirrored.json) | main, getRecentPosts |
| `shorts.js` | 쇼츠 대본 생성(OpenAI gpt-5.4-mini) → 프로젝트/쇼츠대본 저장. 제목·태그 포함 | generateShorts, shortsExists |
| `openai.js` | OpenAI Chat Completions 공용 호출(axios, 재시도). 모델 설정은 MODELS | chat, MODELS |
| `alert.js` | 실패 알림: 슬랙(chat.postMessage) + 네이버 SMTP 메일 동시 발송 | sendAlert |
| `wpPosts.js` | 워드프레스 글 조회. 계정 있으면 XML-RPC(비공개 포함)+문단 변환(autop), 없으면 공개 REST | getRecentPosts, getPost |
| `htmlEntities.js` | HTML 엔티티 디코딩 공용 함수 | decodeEntities, decodeDeep |
| `triggerGenerate.js` | 로컬→GitHub Actions(글 생성) dispatch 후 실행 완료 대기, 실패·시간초과 알림 (git remote의 토큰 사용) | dispatch, waitForRun |
| `openLogin.js` | Whale(9222) 띄우고 티스토리 로그인 페이지 열기 (세션 만료 복구용) | main |
| `backfillShorts.js` | 기존 미러링 글 전체에 쇼츠 대본 일괄 생성 | main |
| `pipeline.bat` | 작업 스케줄러가 실행: 트리거→대기→미러링 | — |
| `티스토리-로그인.bat` | openLogin.js 더블클릭 실행용 | — |
| `server.js` | (구) Express 서버 — 현재 파이프라인과 무관 | — |

## 외부 연동·계정

| 대상 | 위치 |
|------|------|
| 워드프레스 | cheetahfather.wordpress.com — **사이트 비공개**(2026-09-14~). XML-RPC로 발행·조회 |
| 티스토리 | ddr5558.tistory.com (Whale 9222 원격디버깅 자동화) — 새 글 **비공개** 저장(2026-09-14~) |
| 슬랙 알림 | NIBC-개인 워크스페이스 #파이프라인 (봇 hermes) |
| 광고 | 카카오 애드핏 (Tistory 연동) |
| 검색 | 구글 서치콘솔 + 네이버 서치어드바이저 등록됨 |

## 설정·상태 파일 (gitignore, 로컬 전용)

| 파일 | 내용 |
|------|------|
| `.shorts-config.json` | OpenAI API 키 `openaiKey` (쇼츠 생성용). 클라우드는 GitHub Secret `OPENAI_API_KEY` |
| `.alert-config.json` | 네이버 SMTP 계정/앱비밀번호 |
| `.wp-config.json` | 워드프레스 계정(username/password) — 비공개 사이트 글 조회용 |
| `.slack-config.json` | 슬랙 봇 토큰(botToken) + 알림 채널 ID(channel) |
| `mirrored.json` | 미러링 완료 글 ID 목록 (중복방지) |
| `whale-profile/` | 티스토리 로그인 세션(쿠키) — 절대 커밋 금지 |

## 자주 손대는 지점

- **기사 품질/주제/면책** → `blogGenerator.js`의 generateBlogPost 프롬프트
- **티스토리 제목·태그·발행** → `tistory.js`
- **쇼츠 대본 형식** → `shorts.js`의 prompt
- **AI 모델 변경** → `openai.js`의 MODELS
- **발행 시각** → `.github/workflows/blog-generator.yml`(클라우드 cron) + 작업 스케줄러 "TistoryMirror"(로컬)
