// 알림 모듈 — 슬랙(.slack-config.json)과 메일(.alert-config.json)로 동시에 보낸다.
// 둘 중 하나가 실패하거나 설정이 없어도 나머지는 발송되며, 절대 throw하지 않는다.
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

function readConfig(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
  } catch {
    return null;
  }
}

async function sendSlack(subject, text) {
  const cfg = readConfig(".slack-config.json");
  if (!cfg || !cfg.botToken || !cfg.channel) {
    console.log("슬랙 설정(.slack-config.json) 없음 — 슬랙 알림 생략");
    return;
  }
  try {
    const res = await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel: cfg.channel, text: `:rotating_light: *${subject}*\n${text}` },
      {
        headers: { Authorization: `Bearer ${cfg.botToken}`, "Content-Type": "application/json; charset=utf-8" },
        timeout: 15000,
      }
    );
    // 슬랙 API는 실패해도 HTTP 200에 ok:false로 응답한다
    if (res.data && res.data.ok) console.log("💬 슬랙 알림 발송됨");
    else console.log("슬랙 알림 발송 실패:", res.data && res.data.error);
  } catch (e) {
    console.log("슬랙 알림 발송 실패:", e.message);
  }
}

async function sendMail(subject, text) {
  const cfg = readConfig(".alert-config.json");
  if (!cfg) {
    console.log("알림 설정(.alert-config.json) 없음 — 메일 생략");
    return;
  }
  if (!cfg.user || !cfg.pass) {
    console.log("알림 설정 불완전(user/pass 없음) — 메일 생략");
    return;
  }
  try {
    // host가 지정되면 직접 SMTP(네이버 등), 아니면 service 약칭(gmail 등)
    const transportConfig = cfg.host
      ? { host: cfg.host, port: cfg.port || 465, secure: cfg.secure !== false }
      : { service: cfg.service || "gmail" };
    transportConfig.auth = { user: cfg.user, pass: cfg.pass };
    const transporter = nodemailer.createTransport(transportConfig);
    await transporter.sendMail({
      from: cfg.user,
      to: cfg.to || cfg.user,
      subject,
      text,
    });
    console.log("📧 알림 메일 발송됨 →", cfg.to || cfg.user);
  } catch (e) {
    console.log("알림 메일 발송 실패:", e.message);
  }
}

async function sendAlert(subject, text) {
  await Promise.all([sendSlack(subject, text), sendMail(subject, text)]);
}

module.exports = { sendAlert };
