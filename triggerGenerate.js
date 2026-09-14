// 클라우드(GitHub Actions) 워드프레스 글 생성 워크플로를 트리거하고, 끝날 때까지 기다린다.
// GitHub 예약(cron)이 불안정해서, 로컬에서 직접 트리거해 안정성 확보.
// 트리거 거절·클라우드 실행 실패·시간 초과는 모두 알림(슬랙+메일)으로 보낸다.
const { execSync } = require("child_process");
const https = require("https");
const { sendAlert } = require("./alert");

const REPO = "ddr5558/ai-monetization-pipeline";
const WORKFLOW = "blog-generator.yml";
const WAIT_LIMIT_MS = 10 * 60 * 1000; // 평소 1~2분. 10분 넘으면 이상으로 본다.
const POLL_MS = 15 * 1000;

function getToken() {
  try {
    const url = execSync("git remote get-url origin", { cwd: __dirname }).toString().trim();
    const m = url.match(/:\/\/[^:]+:([^@]+)@/);
    return m ? m[1] : null;
  } catch { return null; }
}

function github(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: "token " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "local-trigger",
    };
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = https.request({ hostname: "api.github.com", path, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ code: res.statusCode, text }));
    });
    req.setTimeout(30000, () => req.destroy(new Error("GitHub API 응답 시간 초과")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// inputs가 null이면 inputs 필드 자체를 보내지 않는다.
// GitHub는 워크플로에 선언되지 않은 inputs를 받으면 422로 거절하고 실행도 하지 않는다.
function dispatch(token, inputs) {
  const body = { ref: "main" };
  if (inputs) body.inputs = inputs;
  return github(token, "POST", `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sinceMs 이후 생성된 dispatch 실행을 찾아 완료될 때까지 기다린다.
// 반환: { run } (완료) 또는 { timeout: true, run }
async function waitForRun(token, sinceMs) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  let run = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      const res = await github(token, "GET", `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`);
      if (res.code !== 200) continue; // 일시 오류는 다음 폴링에서 재시도
      const runs = JSON.parse(res.text).workflow_runs || [];
      // 로컬·GitHub 시계 차이를 감안해 30초 여유
      run = runs.find((r) => new Date(r.created_at).getTime() >= sinceMs - 30000) || null;
      if (run && run.status === "completed") return { run };
    } catch (e) {
      console.log("실행 상태 조회 실패(재시도):", e.message);
    }
  }
  return { timeout: true, run };
}

async function fail(msg) {
  console.log(msg);
  process.exitCode = 1;
  await sendAlert(
    "[블로그 자동발행] 워드프레스 글 생성 실패",
    `${msg}\n\n발생 시각: ${new Date().toLocaleString("ko-KR")}`
  );
}

async function main() {
  // 사용법: node triggerGenerate.js [kr|us]
  // 인자가 없으면 inputs 없이 보낸다 → 워크플로 기본값(us). 원격 워크플로 버전과 무관하게 동작.
  const arg = process.argv[2] && process.argv[2].toLowerCase();
  if (arg && !["kr", "us"].includes(arg)) {
    console.log(`알 수 없는 소재 국적 "${arg}" (kr 또는 us)`);
    process.exitCode = 1;
    return;
  }
  const token = getToken();
  if (!token) return fail("GitHub 토큰 없음 - 생성 트리거 생략 (git remote URL에 토큰이 없습니다)");

  const label = arg || "기본";
  const sinceMs = Date.now();
  let res = await dispatch(token, arg ? { source: arg } : null);
  // 원격 워크플로가 아직 source 입력을 모르는 버전이면(=push 전) 422가 온다.
  // us는 입력 없이 보내도 같은 결과이므로 재시도한다. kr은 us 글이 나가면 안 되므로 재시도하지 않는다.
  if (res.code === 422 && /Unexpected inputs/.test(res.text) && arg === "us") {
    console.log("원격 워크플로에 source 입력이 없어 inputs 없이 재시도합니다.");
    res = await dispatch(token, null);
  }
  if (res.code !== 204) {
    return fail(`생성 트리거(${label}) 거절: 응답코드 ${res.code} ${res.text.slice(0, 300)}`);
  }
  console.log(`워드프레스 생성 트리거(${label}): ✅ 성공 — 클라우드 실행 완료 대기 중...`);

  const { run, timeout } = await waitForRun(token, sinceMs);
  const link = run ? `\n실행 기록: ${run.html_url}` : "";
  if (timeout) {
    return fail(`클라우드 글 생성이 ${WAIT_LIMIT_MS / 60000}분 안에 끝나지 않았습니다 (상태: ${run ? run.status : "실행 못 찾음"})${link}`);
  }
  if (run.conclusion !== "success") {
    return fail(`클라우드 글 생성 실행이 실패했습니다 (결과: ${run.conclusion})${link}`);
  }
  const secs = Math.round((new Date(run.updated_at) - new Date(run.created_at)) / 1000);
  console.log(`클라우드 글 생성 완료: ✅ ${secs}초 소요`);
}

if (require.main === module) {
  main().catch((e) => fail("트리거 오류: " + e.message));
}

module.exports = { waitForRun, getToken };
