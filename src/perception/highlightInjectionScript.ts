/**
 * Sprint 017 M1 T06 — Highlight injection script builder (page context).
 *
 * 책임: WebContentsView 페이지 컨텍스트 (browser 환경) 에서 실행될 self-contained 스크립트 2종을
 * 문자열로 빌드. `webContents.executeJavaScript(script, true)` 가 main world 에서 실행.
 *
 *   1. `buildSerializeScript()` — `window.getSelection()` 의 첫 Range 를 `HighlightAnchor` 로 직렬화
 *      후 JSON-safe 객체 반환 (or null if no selection / iframe / Shadow DOM cross-boundary).
 *   2. `buildRestoreScript(anchors)` — anchors 배열을 받아 CSS Highlight API (`CSS.highlights`) 로
 *      등록. 미지원 환경은 graceful no-op.
 *
 * 본 스크립트는 `src/perception/highlightAnchor.ts` 알고리즘 (childNodes path + contentHash +
 * prefix/suffix fuzzy fallback) 의 browser-safe 재구현이다. `node:crypto` 사용 불가 → `crypto.subtle`
 * 비동기 SHA-256 사용. main 측 모듈과 결과 hex 가 동일하도록 normalize + delimiter (U+241F) 정합 유지.
 *
 * codex 사전 협의 (2026-05-22, threadId 019e4b75) hotfix 후보 1 — main / page 두 구현 divergence
 * 위험 → 본 모듈 단위 회귀가 동일 anchor 결과를 highlightAnchor.ts 와 cross-check.
 *
 * IIFE async — executeJavaScript 가 `Promise<value>` 반환을 자동 await.
 */

/**
 * 페이지 컨텍스트에서 반환되는 anchor schema — main 의 `HighlightAnchor` 와 동일.
 * 본 타입은 main 측 type alias 가 아니라 별도 정의 — main / page 간 cycle 차단.
 */
export interface InjectedAnchor {
  rootSelector: string
  startPath: number[]
  endPath: number[]
  startOffset: number
  endOffset: number
  selectedText: string
  prefix: string
  suffix: string
  contentHash: string
  contextHash: string
}

export interface SerializeResult {
  ok: boolean
  anchor: InjectedAnchor | null
  /**
   * 실패 코드:
   *   - 'no_selection': window.getSelection().rangeCount === 0 또는 collapsed
   *   - 'unsupported_selection': iframe / Shadow DOM cross-boundary range (root.contains false)
   *   - 'serialize_failed': path 계산 실패 (방어적)
   */
  errorCode?: 'no_selection' | 'unsupported_selection' | 'serialize_failed'
}

export interface RestoreResult {
  ok: boolean
  registered: number
  /** CSS Highlight API 미지원 환경 시 true. T08 toast fallback path. */
  apiSupported: boolean
  /** anchor 별 복원 strategy 보고 (디버그 / 단위 회귀용). */
  details: Array<{
    id: string
    strategy: 'path' | 'context-fuzzy' | 'failed'
    contentHashMatch: boolean
  }>
}

/** 본 prefix 로 등록된 CSS Highlight 는 다음 restore 시 자동 clear (registry 누수 차단 — codex hotfix 후보 5). */
export const HIGHLIGHT_NAME_PREFIX = 'flowbrowser-note-'

/** prefix/suffix 길이 — main 측 `CONTEXT_LEN` 정합. */
export const CONTEXT_LEN = 32

/**
 * Serialize 스크립트 빌드. rootSelector 인자는 root 후보 (없으면 'body').
 * 본 IIFE 가 main world 에서 실행되어 anchor JSON 을 반환.
 */
export function buildSerializeScript(rootSelector: string = 'body'): string {
  return `(async () => {
${SHARED_HELPERS_SOURCE}
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { ok: false, anchor: null, errorCode: 'no_selection' };
    }
    const range = sel.getRangeAt(0);
    if (!range || range.collapsed) {
      return { ok: false, anchor: null, errorCode: 'no_selection' };
    }
    const root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
    if (!root) {
      return { ok: false, anchor: null, errorCode: 'serialize_failed' };
    }
    try {
      __fbAssertWithinRoot(root, range.startContainer);
      __fbAssertWithinRoot(root, range.endContainer);
    } catch (err) {
      return { ok: false, anchor: null, errorCode: 'unsupported_selection' };
    }
    const startPath = __fbComputeChildNodesPath(root, range.startContainer);
    const endPath = __fbComputeChildNodesPath(root, range.endContainer);
    if (!startPath || !endPath) {
      return { ok: false, anchor: null, errorCode: 'serialize_failed' };
    }
    const selectedText = range.toString();
    if (!selectedText) {
      return { ok: false, anchor: null, errorCode: 'no_selection' };
    }
    const rootText = root.textContent || '';
    const startCharOffset = __fbCharacterOffsetInRoot(root, range.startContainer, range.startOffset);
    const endCharOffset = __fbCharacterOffsetInRoot(root, range.endContainer, range.endOffset);
    let prefix = '';
    let suffix = '';
    if (startCharOffset >= 0 && endCharOffset >= startCharOffset) {
      prefix = __fbTakeRight(rootText.substring(0, startCharOffset), ${CONTEXT_LEN});
      suffix = __fbTakeLeft(rootText.substring(endCharOffset), ${CONTEXT_LEN});
    } else {
      const idx = rootText.indexOf(selectedText);
      if (idx >= 0) {
        prefix = __fbTakeRight(rootText.substring(0, idx), ${CONTEXT_LEN});
        suffix = __fbTakeLeft(rootText.substring(idx + selectedText.length), ${CONTEXT_LEN});
      }
    }
    const contentHash = await __fbSha256Hex(__fbNormalizeText(rootText));
    const contextHash = await __fbSha256Hex(prefix + '\\u241f' + selectedText + '\\u241f' + suffix);
    return {
      ok: true,
      anchor: {
        rootSelector: ${JSON.stringify(rootSelector)},
        startPath: startPath,
        endPath: endPath,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        selectedText: selectedText,
        prefix: prefix,
        suffix: suffix,
        contentHash: contentHash,
        contextHash: contextHash
      }
    };
  } catch (err) {
    return { ok: false, anchor: null, errorCode: 'serialize_failed' };
  }
})()`
}

/**
 * Restore 스크립트 빌드. anchors 는 `{ id, anchor }` 배열 — 각 id 는 CSS Highlight name 후보.
 *
 * CSS Highlight API 미지원 환경 (Chromium 105 미만 / happy-dom) → `apiSupported: false` 반환 + no-op.
 */
export function buildRestoreScript(
  records: Array<{ id: string; anchor: InjectedAnchor }>,
  rootSelector: string = 'body'
): string {
  return `(async () => {
${SHARED_HELPERS_SOURCE}
${RESTORE_HELPERS_SOURCE}
  const records = ${JSON.stringify(records)};
  const result = { ok: true, registered: 0, apiSupported: false, details: [] };
  const root = document.querySelector(${JSON.stringify(rootSelector)}) || document.body;
  if (!root) { result.ok = false; return result; }
  const highlightsApi = (typeof CSS !== 'undefined' && CSS && CSS.highlights) || null;
  const HighlightCtor = (typeof Highlight !== 'undefined') ? Highlight : null;
  if (highlightsApi && HighlightCtor) {
    result.apiSupported = true;
    // 기존 flowbrowser-note-* 등록 clear (registry 누수 / 중복 차단).
    try {
      const toDelete = [];
      highlightsApi.forEach((_, name) => {
        if (typeof name === 'string' && name.indexOf(${JSON.stringify(HIGHLIGHT_NAME_PREFIX)}) === 0) {
          toDelete.push(name);
        }
      });
      for (const name of toDelete) { highlightsApi.delete(name); }
    } catch (_e) {}
  }
  for (const rec of records) {
    const restored = await __fbDeserializeAnchor(root, rec.anchor);
    result.details.push({
      id: rec.id,
      strategy: restored.strategy,
      contentHashMatch: restored.contentHashMatch
    });
    if (restored.range && result.apiSupported) {
      try {
        const hl = new HighlightCtor(restored.range);
        // codex dual review Finding 3 흡수 — registry name 도 sanitize. buildHighlightCssForIds 의
        // ::highlight(<sanitized>) 룰과 정합 (raw id 사용 시 한글/emoji 등이 registry name 와
        // CSS rule name 가 달라져 등록되어도 시각 스타일 미적용).
        const safeName = ${JSON.stringify(HIGHLIGHT_NAME_PREFIX)} + __fbSanitizeId(rec.id);
        highlightsApi.set(safeName, hl);
        result.registered += 1;
      } catch (_e) {}
    }
  }
  return result;
})()`
}

/**
 * 페이지 컨텍스트에서 CSS Highlight API 가 등록한 highlight 의 시각 스타일.
 * `webContents.insertCSS(HIGHLIGHT_CSS)` 로 페이지 stylesheet 에 박음.
 * `::highlight(name)` 는 Chromium 의 CSS Custom Highlight API 정합.
 */
export const HIGHLIGHT_CSS = `::highlight(${HIGHLIGHT_NAME_PREFIX}all) { background-color: rgba(255, 235, 59, 0.45); color: inherit; }
[class*='${HIGHLIGHT_NAME_PREFIX}']:hover { cursor: pointer; }`

/**
 * 페이지 컨텍스트 stylesheet 박는 헬퍼 — 동적 `::highlight(name)` 룰을 한 번에 묶음 등록.
 * 본 PR (T06) 은 단일 색상만 노출. 다중 색 / 클릭 toast 는 T08.
 *
 * 각 highlight name 별 룰 동적 생성 — Chromium 은 `::highlight(<name>)` 가 wildcard 미지원.
 */
export function buildHighlightCssForIds(ids: string[]): string {
  const rules = ids
    .map((id) => {
      const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_')
      return `::highlight(${HIGHLIGHT_NAME_PREFIX}${safe}) { background-color: rgba(255, 235, 59, 0.45); color: inherit; }`
    })
    .join('\n')
  return rules
}

/**
 * 페이지 컨텍스트에서 사용될 공유 helper 함수 module-string.
 * `serialize` / `restore` 두 스크립트 모두 본 source 를 임베드.
 *
 * 본 source 의 모든 함수는 `__fb` prefix — 페이지 글로벌 오염 회피.
 */
const SHARED_HELPERS_SOURCE = `
  function __fbNormalizeText(text) {
    return (text || '').replace(/\\r\\n?/g, '\\n').replace(/[ \\t]+/g, ' ').trim();
  }
  // codex dual review Finding 2 흡수 — crypto.subtle 은 secure context 전용 (https / localhost / file://).
  // 일반 http:// page 에서는 crypto.subtle 이 undefined 거나 digest 호출이 throw 가능.
  // 따라서 사용 가능 여부 detect 후 미지원 시 pure JS SHA-256 폴리필 사용.
  // 폴리필 결과 hex 는 RFC 6234 정합 — main 측 highlightAnchor.ts (node:crypto) 와 동일 hex.
  async function __fbSha256Hex(input) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        const enc = new TextEncoder();
        const bytes = enc.encode(input);
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (_e) {
      // 미지원 환경 — 폴리필로 fallthrough.
    }
    return __fbSha256HexPolyfill(input);
  }
  // pure JS SHA-256 (RFC 6234). secure context 미지원 환경 폴리필.
  // 출력 hex 가 crypto.subtle.digest('SHA-256', ...) / node:crypto.createHash('sha256') 와 동일.
  function __fbSha256HexPolyfill(input) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const enc = new TextEncoder();
    const msg = enc.encode(input);
    const bitLen = msg.length * 8;
    const padLen = (msg.length + 9 + 63) & ~63;
    const buf = new Uint8Array(padLen);
    buf.set(msg);
    buf[msg.length] = 0x80;
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 8, hi, false);
    dv.setUint32(padLen - 4, lo, false);
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const W = new Uint32Array(64);
    function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
    for (let i = 0; i < padLen; i += 64) {
      for (let t = 0; t < 16; t++) {
        W[t] = dv.getUint32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(7, W[t - 15]) ^ rotr(18, W[t - 15]) ^ (W[t - 15] >>> 3);
        const s1 = rotr(17, W[t - 2]) ^ rotr(19, W[t - 2]) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ ((~e) & g);
        const t1 = ((h + S1) | 0) + ((ch + K[t]) | 0) + W[t] | 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const hex = (n) => ((n >>> 0).toString(16).padStart(8, '0'));
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
  }
  // codex dual review Finding 3 흡수 — CSS rule / registry name 양쪽 동일 sanitize.
  // [^a-zA-Z0-9_-] → '_' — 한글 / emoji / 공백 모두 '_' 로 치환. buildHighlightCssForIds 와 정합.
  function __fbSanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  function __fbTakeRight(text, n) {
    const arr = Array.from(text);
    return arr.slice(Math.max(0, arr.length - n)).join('');
  }
  function __fbTakeLeft(text, n) {
    const arr = Array.from(text);
    return arr.slice(0, n).join('');
  }
  function __fbAssertWithinRoot(root, node) {
    if (node === root) return;
    if (!root.contains(node)) {
      throw new Error('range boundary outside root');
    }
  }
  function __fbComputeChildNodesPath(root, target) {
    if (target === root) return [];
    const path = [];
    let current = target;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      const siblings = parent.childNodes;
      let idx = -1;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === current) { idx = i; break; }
      }
      if (idx < 0) return null;
      path.unshift(idx);
      current = parent;
    }
    if (current !== root) return null;
    return path;
  }
  function __fbResolveChildNodesPath(root, path) {
    let current = root;
    for (const idx of path) {
      if (!current) return null;
      const children = current.childNodes;
      if (idx < 0 || idx >= children.length) return null;
      current = children.item(idx);
    }
    return current;
  }
  function __fbCollectTextNodes(root) {
    const result = [];
    const TEXT_NODE = 3;
    const visit = (n) => {
      if (n.nodeType === TEXT_NODE) { result.push(n); return; }
      const children = n.childNodes;
      for (let i = 0; i < children.length; i++) { visit(children[i]); }
    };
    visit(root);
    return result;
  }
  function __fbCharacterOffsetInRoot(root, container, offset) {
    const TEXT_NODE = 3;
    let acc = 0; let result = -1; let done = false;
    const visit = (n) => {
      if (done) return;
      if (n === container) {
        if (n.nodeType === TEXT_NODE) { result = acc + offset; }
        else {
          const limit = Math.min(offset, n.childNodes.length);
          for (let i = 0; i < limit; i++) { visit(n.childNodes[i]); if (done) return; }
          result = acc;
        }
        done = true; return;
      }
      if (n.nodeType === TEXT_NODE) { acc += n.data.length; return; }
      const children = n.childNodes;
      for (let i = 0; i < children.length; i++) { visit(children[i]); if (done) return; }
    };
    visit(root);
    return result;
  }
  function __fbCharOffsetsToRange(root, doc, startChar, endChar) {
    if (startChar < 0 || endChar < startChar) return null;
    const textNodes = __fbCollectTextNodes(root);
    let accumulated = 0;
    let startNode = null; let startNodeOffset = 0;
    let endNode = null; let endNodeOffset = 0;
    for (const node of textNodes) {
      const nodeLen = node.data.length;
      const nodeStart = accumulated;
      const nodeEnd = accumulated + nodeLen;
      if (!startNode && startChar >= nodeStart && startChar <= nodeEnd) {
        startNode = node; startNodeOffset = startChar - nodeStart;
      }
      if (!endNode && endChar >= nodeStart && endChar <= nodeEnd) {
        endNode = node; endNodeOffset = endChar - nodeStart;
      }
      if (startNode && endNode) break;
      accumulated = nodeEnd;
    }
    if (!startNode || !endNode) return null;
    try {
      const range = doc.createRange();
      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);
      return range;
    } catch (_e) { return null; }
  }
`

const RESTORE_HELPERS_SOURCE = `
  async function __fbDeserializeAnchor(root, anchor) {
    const doc = root.ownerDocument;
    if (!doc) return { range: null, strategy: 'failed', contentHashMatch: false };
    const TEXT_NODE = 3;
    const rootText = root.textContent || '';
    const currentContentHash = await __fbSha256Hex(__fbNormalizeText(rootText));
    const contentHashMatch = currentContentHash === anchor.contentHash;
    if (contentHashMatch) {
      const startNode = __fbResolveChildNodesPath(root, anchor.startPath);
      const endNode = __fbResolveChildNodesPath(root, anchor.endPath);
      if (startNode && endNode && startNode.nodeType === TEXT_NODE && endNode.nodeType === TEXT_NODE) {
        const startLen = startNode.data.length;
        const endLen = endNode.data.length;
        if (anchor.startOffset >= 0 && anchor.startOffset <= startLen &&
            anchor.endOffset >= 0 && anchor.endOffset <= endLen) {
          try {
            const range = doc.createRange();
            range.setStart(startNode, anchor.startOffset);
            range.setEnd(endNode, anchor.endOffset);
            if (range.toString() === anchor.selectedText) {
              return { range: range, strategy: 'path', contentHashMatch: contentHashMatch };
            }
          } catch (_e) {}
        }
      }
    }
    if (!anchor.selectedText) {
      return { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
    }
    const needle = anchor.prefix + anchor.selectedText + anchor.suffix;
    const firstIdx = rootText.indexOf(needle);
    if (firstIdx < 0) {
      if (!anchor.prefix && !anchor.suffix) {
        const fIdx = rootText.indexOf(anchor.selectedText);
        if (fIdx < 0) return { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
        const sIdx = rootText.indexOf(anchor.selectedText, fIdx + 1);
        if (sIdx >= 0) return { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
        const range = __fbCharOffsetsToRange(root, doc, fIdx, fIdx + anchor.selectedText.length);
        return range
          ? { range: range, strategy: 'context-fuzzy', contentHashMatch: contentHashMatch }
          : { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
      }
      return { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
    }
    const secondIdx = rootText.indexOf(needle, firstIdx + 1);
    if (secondIdx >= 0) {
      return { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
    }
    const selStart = firstIdx + anchor.prefix.length;
    const selEnd = selStart + anchor.selectedText.length;
    const range = __fbCharOffsetsToRange(root, doc, selStart, selEnd);
    return range
      ? { range: range, strategy: 'context-fuzzy', contentHashMatch: contentHashMatch }
      : { range: null, strategy: 'failed', contentHashMatch: contentHashMatch };
  }
`
