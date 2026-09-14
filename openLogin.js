// 자동화 전용 Whale(9222) 창을 띄우고 티스토리 로그인 페이지를 연다.
// 세션 만료 알림을 받았을 때 이걸 실행해 로그인하면 된다.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const { WHALE_PATH } = require("./whalePath"); // 자동 탐지 (업데이트 대응)

function portUp() {
  return new Promise((r) => {
    const req = http.get("http://localhost:9222/json/version", (res) => { res.resume(); r(res.statusCode === 200); });
    req.on("error", () => r(false));
    req.setTimeout(2000, () => { req.destroy(); r(false); });
  });
}

function markProfileExitedClean() {
  const pref = path.join(__dirname, "whale-profile", "Default", "Preferences");
  try {
    const d = JSON.parse(fs.readFileSync(pref, "utf8"));
    if (d.profile) { d.profile.exit_type = "Normal"; d.profile.exited_cleanly = true; fs.writeFileSync(pref, JSON.stringify(d)); }
  } catch {}
}

async function main() {
  if (!(await portUp())) {
    if (!WHALE_PATH) throw new Error("Whale 실행 파일을 찾지 못했습니다 (WHALE_BROWSER_PATH 환경변수로 지정 가능)");
    markProfileExitedClean();
    spawn(WHALE_PATH, ["--remote-debugging-port=9222", `--user-data-dir=${path.join(__dirname, "whale-profile")}`], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await portUp()) break; }
  }
  const b = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });
  const p = await b.newPage();
  await p.goto("https://www.tistory.com/auth/login");
  b.disconnect();
  console.log("\n>> 열린 Whale 창에서 티스토리(카카오)에 로그인하세요. ('로그인 상태 유지' 체크)\n");
}
main().catch((e) => console.log("오류:", e.message));
