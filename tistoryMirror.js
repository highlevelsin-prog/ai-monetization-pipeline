// 워드프레스 → 티스토리 미러링 (로컬 PC에서 작업 스케줄러로 실행)
// 워드프레스 최신 글을 가져와, 아직 티스토리에 안 올린 글만 발행한다.
const fs = require("fs");
const path = require("path");
const { postToTistory, isOnTistory } = require("./tistory");
const { sendAlert } = require("./alert");
const { generateShorts, shortsExists } = require("./shorts");
const { downloadNaverImages } = require("./naverImages");
const { getRecentPosts, readWpConfig } = require("./wpPosts");

const MIRRORED_FILE = path.join(__dirname, "mirrored.json");
// 최근 몇 개를 확인할지. PC가 며칠 꺼져 있어도(하루 3개) 밀린 글이 확인 범위 밖으로 밀려나지 않게 넉넉히.
const FETCH_COUNT = 20;
const MAX_PER_RUN = 3; // 한 번 실행에 최대 몇 개까지 올릴지 (도배 방지)

// 이미 미러링한 글 ID 목록 로드/저장
function loadMirrored() {
  try {
    return JSON.parse(fs.readFileSync(MIRRORED_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveMirrored(ids) {
  fs.writeFileSync(MIRRORED_FILE, JSON.stringify(ids, null, 2));
}

async function main() {
  // 워드프레스 글이 비공개로 발행되므로 .wp-config.json이 없으면 새 글이 보이지 않는다
  if (!readWpConfig()) {
    console.log("⚠️ .wp-config.json 없음 - 공개 글만 조회됩니다 (비공개 글은 미러링 안 됨)");
  }
  const posts = await getRecentPosts(FETCH_COUNT);
  const mirrored = loadMirrored();

  // 아직 안 올린 글을 오래된 것부터(시간순) MAX_PER_RUN개 고른다.
  // (API는 최신순(desc)이므로 reverse 후 slice → 밀린 글이 있어도 순서대로 빠짐없이 처리)
  const toMirror = posts
    .filter((p) => !mirrored.includes(p.post_id))
    .reverse()
    .slice(0, MAX_PER_RUN);

  let sessionExpired = false;
  const failures = []; // 세션 만료 외의 발행 실패 (알림용)
  let skipped = 0;
  if (toMirror.length === 0) {
    console.log("미러링할 새 글이 없습니다.");
  } else {
    console.log(`미러링 대상 ${toMirror.length}개`);
    for (const p of toMirror) {
      try {
        console.log(`\n[티스토리 발행] ${p.post_title}`);
        // 지난 실행에서 발행은 됐는데 확인 단계에서 실패했던 글이면 다시 올리지 않는다.
        if ((await isOnTistory(p.post_title)) === true) {
          console.log("이미 티스토리에 있음 - 기록만 하고 건너뜀");
        } else {
          await postToTistory(p.post_title, p.post_content);
        }
        mirrored.push(p.post_id);
        saveMirrored(mirrored); // 한 건 성공할 때마다 즉시 기록 (중복 방지)
      } catch (e) {
        console.log("발행 건너뜀:", p.post_title, "-", e.message);
        skipped++;
        if (/세션 만료|로그인/.test(e.message)) sessionExpired = true;
        else failures.push(`- ${p.post_title}\n  사유: ${e.message}`);
        // 세션 만료/Whale 없음 등은 다음 실행에서 재시도되도록 기록하지 않음
      }
    }
  }

  // 쇼츠 대본 보완 단계 — 미러링된 글 중 대본이 없는 것을 생성한다.
  // (방금 미러링한 글 + 이전에 일시 오류로 빠진 글까지 매번 재시도되어 누락 방지)
  for (const p of posts) {
    if (!mirrored.includes(p.post_id)) continue;
    if (!shortsExists(p.post_id)) {
      console.log(`\n[쇼츠 대본] ${p.post_title}`);
      await generateShorts({
        id: p.post_id,
        title: p.post_title,
        contentHtml: p.post_content,
        url: p.post_link,
      });
    }
    // 네이버용 이미지 다운로드 (이미 받았으면 내부에서 건너뜀)
    await downloadNaverImages({
      id: p.post_id,
      title: p.post_title,
      contentHtml: p.post_content,
    });
  }

  console.log("\n미러링 작업 종료.");

  // 세션 만료로 발행을 건너뛰었으면 메일 알림
  if (sessionExpired) {
    await sendAlert(
      "[티스토리 자동발행] 로그인 세션 만료 — 재로그인 필요",
      `티스토리 로그인 세션이 만료되어 글 ${skipped}건 발행을 건너뛰었습니다.\n\n` +
        `Whale(9222) 창에서 티스토리(카카오)에 다시 로그인해 주세요. ("로그인 상태 유지" 체크)\n` +
        `로그인 후에는 다음 예약 실행 때 자동으로 밀린 글이 발행됩니다.\n\n` +
        `발생 시각: ${new Date().toLocaleString("ko-KR")}`
    );
  }

  // 세션 만료 외 사유로 발행이 실패한 글이 있으면 알림 (다음 실행에서 자동 재시도됨)
  if (failures.length) {
    await sendAlert(
      `[티스토리 자동발행] 발행 실패 ${failures.length}건`,
      `${failures.join("\n")}\n\n다음 예약 실행에서 자동으로 재시도합니다.\n` +
        `발생 시각: ${new Date().toLocaleString("ko-KR")}`
    );
  }
}

main().catch(async (e) => {
  console.error("오류:", e);
  await sendAlert(
    "[티스토리 자동발행] 미러링 작업 오류로 중단",
    `${e.message}\n\n발생 시각: ${new Date().toLocaleString("ko-KR")}`
  );
  process.exit(1);
});
