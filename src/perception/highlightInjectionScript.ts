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
        highlightsApi.set(${JSON.stringify(HIGHLIGHT_NAME_PREFIX)} + rec.id, hl);
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
  async function __fbSha256Hex(input) {
    const enc = new TextEncoder();
    const bytes = enc.encode(input);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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
