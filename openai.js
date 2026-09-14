// OpenAI Chat Completions 호출 공용 모듈 (블로그 생성·쇼츠 대본)
// SDK 없이 axios로 호출한다 — 의존성을 늘리지 않고, 클라우드(npm ci)와 로컬이 같은 코드를 쓴다.
const axios = require("axios");

const MODELS = {
  blog: "gpt-5.4", // 기사 생성 (품질 우선)
  shorts: "gpt-5.4-mini", // 쇼츠 대본 (비용 우선)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 일시 오류(429·5xx·네트워크)는 재시도, 그 외(키 오류·잘못된 요청)는 바로 throw
async function chat({ apiKey, model, prompt, maxTokens, reasoningEffort, retries = 2 }) {
  if (!apiKey) throw new Error("OpenAI API 키 없음");
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    // GPT-5 계열은 추론 토큰도 이 한도에 포함되므로 출력 분량보다 넉넉히 잡는다
    max_completion_tokens: maxTokens,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios.post("https://api.openai.com/v1/chat/completions", body, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 5 * 60 * 1000,
      });
      const choice = res.data.choices && res.data.choices[0];
      const text = choice && choice.message && choice.message.content;
      if (!text || !text.trim()) {
        throw new Error(`OpenAI 응답이 비어 있음 (finish_reason: ${choice && choice.finish_reason})`);
      }
      return text;
    } catch (e) {
      const status = e.response && e.response.status;
      const retriable = !status || status === 429 || status >= 500;
      const detail = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
      if (!retriable || attempt >= retries) throw new Error(`OpenAI 호출 실패(${status || "network"}): ${detail}`);
      console.log(`OpenAI 재시도(${attempt + 1}/${retries}):`, detail);
      await sleep(5000 * (attempt + 1));
    }
  }
}

module.exports = { chat, MODELS };
