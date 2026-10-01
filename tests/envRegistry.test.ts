/**
 * envRegistry.test.ts — 환경변수 레지스트리 ↔ 실제 소스 ↔ RUNBOOK §4 3자 대조. 2026-09-30
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * RUNBOOK §4 는 "값은 커밋하지 않고 **키 목록**만 보관소에 스냅샷으로 둔다"고 약속한다.
 * 그 목록이 복구의 전부인데, 2026-09-05 작성 당시 11개에서 멈춰 있었다.
 * 그 사이 늘어난 키가 유실되면 서비스는 뜨지만 **조용히 다른 서비스가 된다**
 * (확정본 약관이 초안으로, 고지된 수탁자가 「고지 전」으로, 정산이 계산 중단으로).
 * 500 이 안 나므로 사람이 못 알아챈다 → 파일 수준에서 고정한다.
 *
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 process.env 도 건드리지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ENV_VARS,
  envVar,
  envKeys,
  restorableVars,
  restorableGroups,
  switchKeys,
  isEnvKeyToken,
  scanEnvReads,
  auditEnvReads,
  runbookSection4,
  parseDocumentedKeys,
  auditDocCoverage,
  auditSwitchParsing,
  auditPublicPrefix,
  auditRegistryShape,
  envRegistryStatus,
} from '../src/lib/envRegistry.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * `src` 아래 .ts/.tsx 전부. 단 `src/src/` 는 2026-09 시점에 남아 있는 **옛 사본 트리**라
 * 제외한다(파일 삭제가 야간 금지 규칙에 걸려 아직 치우지 못했다 — CHANGELOG 배치173·174 메모).
 * 죽은 코드가 가드를 끌고 가게 두지 않는다.
 */
function sourceFiles(): string[] {
  const base = path.join(ROOT, 'src');
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (depth === 0 && e.name === 'src') continue;   // src/src — 옛 사본
        walk(path.join(dir, e.name), depth + 1);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  walk(base, 0);
  return out;
}

const FILES = sourceFiles();
const read = (f: string) => fs.readFileSync(f, 'utf8');

/** 소스 전체에서 직접 읽는 env 키의 합집합. */
function allFoundKeys(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const f of FILES) {
    for (const k of scanEnvReads(read(f))) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      m.set(k, [...(m.get(k) ?? []), rel]);
    }
  }
  return m;
}

// ── 순수 함수 단위 ──────────────────────────────────────────────────────────

test('isEnvKeyToken: 밑줄 없는 약어(GET·DB·PITR)는 env 키로 보지 않는다', () => {
  assert.equal(isEnvKeyToken('DATABASE_URL'), true);
  assert.equal(isEnvKeyToken('NODE_ENV'), true);
  assert.equal(isEnvKeyToken('GET'), false);
  assert.equal(isEnvKeyToken('PITR'), false);
  assert.equal(isEnvKeyToken('RTO'), false);
  assert.equal(isEnvKeyToken('lower_case'), false);
  assert.equal(isEnvKeyToken(''), false);
  assert.equal(isEnvKeyToken(null), false);
});

test('scanEnvReads: 세 형태를 잡고 간접 접근은 잡지 못한다(한계를 명시)', () => {
  const src = `
    const a = process.env.DATABASE_URL;
    const b = env.PARTNER_COMMISSION_RATES;
    const c = env['PRIVACY_PROCESSORS'];
    const d = env[def.envVersion];      // 간접 — 원리상 못 잡는다
    const e = env.KEY;                  // 밑줄 없음 → env 키 아님
  `;
  assert.deepEqual(scanEnvReads(src), ['DATABASE_URL', 'PARTNER_COMMISSION_RATES', 'PRIVACY_PROCESSORS']);
  assert.deepEqual(scanEnvReads(null), []);
});

test('auditSwitchParsing: 스위치는 === \'true\' 비교만 허용한다', () => {
  assert.deepEqual(auditSwitchParsing(`const x = process.env.PAYMENTS_LIVE === 'true';`), []);
  const bad = auditSwitchParsing(`const x = Boolean(env.PAYMENTS_LIVE); const y = env.ENTITLEMENTS_ENFORCE !== 'false';`);
  assert.deepEqual(bad.map((b) => b.key).sort(), ['ENTITLEMENTS_ENFORCE', 'PAYMENTS_LIVE']);
  // 스위치가 아닌 키는 비교 방식을 따지지 않는다.
  assert.deepEqual(auditSwitchParsing(`const r = env.VERCEL_REGION ?? '';`), []);
});

test('auditEnvReads: 미등록 키와 유령 항목을 양방향으로 잡는다', () => {
  const withUnknown = auditEnvReads([...envKeys(), 'TOTALLY_NEW_KEY']);
  assert.deepEqual(withUnknown.unregistered, ['TOTALLY_NEW_KEY']);
  // 아무것도 못 찾았다고 하면 직접 읽기 키 전부가 stale 로 잡혀야 한다(가드가 살아 있다는 증거).
  const none = auditEnvReads([]);
  assert.ok(none.stale.includes('DATABASE_URL'), '유령 항목 판정이 동작하지 않는다');
  // indirectIn 선언 키는 직접 읽기 스캔 대상이 아니므로 stale 로 몰리지 않는다.
  assert.ok(!none.stale.includes('LEGAL_TERMS_VERSION'));
  assert.ok(!none.stale.includes('PRIVACY_PROCESSORS'));
});

test('parseDocumentedKeys / runbookSection4: 절 분리와 백틱 토큰 추출', () => {
  const md = '# T\n\n## 3. 앞\n`IGNORED_KEY`\n\n## 4. 환경변수\n- `DATABASE_URL`, `SESSION_COOKIE`\n- `GET /x` 는 아니다\n\n## 5. 뒤\n`LATER_KEY`\n';
  const sec = runbookSection4(md);
  assert.match(sec, /^## 4\. 환경변수/);
  assert.ok(!sec.includes('LATER_KEY'), '뒤 절이 섞였다');
  assert.deepEqual(parseDocumentedKeys(sec), ['DATABASE_URL', 'SESSION_COOKIE']);
  assert.equal(runbookSection4('## 1. 없음'), '');
});

test('auditDocCoverage: 복구 대상 누락과 낡은 문구를 가린다', () => {
  const full = restorableVars().map((v) => v.key);
  assert.deepEqual(auditDocCoverage(full), { undocumented: [], unknownInDoc: [] });
  const missing = auditDocCoverage(full.filter((k) => k !== 'LEGAL_DOCS_FINAL'));
  assert.deepEqual(missing.undocumented, ['LEGAL_DOCS_FINAL']);
  assert.deepEqual(auditDocCoverage([...full, 'OLD_REMOVED_KEY']).unknownInDoc, ['OLD_REMOVED_KEY']);
  // 플랫폼 키를 문서에 적어도 "모르는 키"로 보지 않는다.
  assert.deepEqual(auditDocCoverage([...full, 'VERCEL_ENV']).unknownInDoc, []);
});

test('레지스트리 자체 무결성: 중복·형식·설명 누락 없음', () => {
  assert.deepEqual(auditRegistryShape(), []);
  assert.equal(envVar('DATABASE_URL')?.kind, 'secret');
  assert.equal(envVar('없는키'), null);
  assert.equal(envVar(''), null);
  const st = envRegistryStatus();
  assert.equal(st.total, ENV_VARS.length);
  assert.equal(st.restorable + st.platform, st.total);
  assert.ok(st.switches > 0 && st.secrets > 0);
  // 묶음 분해가 복구 대상을 하나도 잃지 않는다.
  assert.equal(restorableGroups().reduce((n, g) => n + g.vars.length, 0), st.restorable);
});

test('NEXT_PUBLIC_ 접두사를 가진 시크릿은 없다 ⬅ 클라이언트 번들에 평문으로 실린다', () => {
  assert.deepEqual(auditPublicPrefix(), []);
});

// ── 실제 소스·문서 대조 ────────────────────────────────────────────────────

test('[실제 소스] 코드가 읽는 env 키가 전부 레지스트리에 있다', () => {
  const found = allFoundKeys();
  assert.ok(FILES.length > 50, `스캔 대상이 너무 적다(${FILES.length}) — 수집 규칙이 빗나갔을 수 있다`);
  const { unregistered, stale } = auditEnvReads([...found.keys()]);
  const where = (k: string) => `${k} (${(found.get(k) ?? []).join(', ')})`;
  assert.deepEqual(unregistered.map(where), [],
    'env 를 새로 읽기 시작했다면 src/lib/envRegistry.ts 와 RUNBOOK §4 에 먼저 등록할 것');
  assert.deepEqual(stale, [],
    '레지스트리에만 남은 유령 키 — 코드에서 사라졌다면 레지스트리·RUNBOOK 에서도 지울 것');
});

test('[실제 소스] indirectIn 으로 선언한 키는 그 파일에 리터럴로 존재한다', () => {
  for (const v of ENV_VARS) {
    if (!v.indirectIn) continue;
    const f = path.join(ROOT, v.indirectIn);
    assert.ok(fs.existsSync(f), `${v.key}: indirectIn 파일이 없다 → ${v.indirectIn}`);
    assert.ok(read(f).includes(`'${v.key}'`),
      `${v.key}: ${v.indirectIn} 에 리터럴이 없다 — 접근 방식이 바뀌었으면 선언을 갱신할 것`);
  }
});

test('[실제 소스] 활성화 스위치는 전부 === \'true\' 로만 판정한다 ⬅ 꺼 둔 줄 알았는데 켜지는 사고 방지', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    for (const v of auditSwitchParsing(read(f))) {
      bad.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: ${v.snippet}`);
    }
  }
  assert.deepEqual(bad, [], `스위치는 'true' 문자열만 ON 이어야 한다(오설정 '1'·'yes'·공백은 OFF 유지)`);
  assert.ok(switchKeys().length >= 8, '스위치 목록이 비정상적으로 짧다');
});

test('[실제 문서] RUNBOOK §4 가 복구해야 할 키를 하나도 빠뜨리지 않는다', () => {
  const md = fs.readFileSync(path.join(ROOT, 'RUNBOOK.md'), 'utf8');
  const sec = runbookSection4(md);
  assert.ok(sec.length > 0, 'RUNBOOK §4 절을 찾지 못했다 — 문서 구조가 바뀌었으면 이 테스트를 함께 볼 것');
  const { undocumented, unknownInDoc } = auditDocCoverage(parseDocumentedKeys(sec));
  assert.deepEqual(undocumented, [],
    'RUNBOOK §4 에 없는 키는 복구 시 조용히 유실된다 — 목록에 추가할 것');
  assert.deepEqual(unknownInDoc, [],
    'RUNBOOK §4 가 코드에 없는 키를 적고 있다 — 낡은 문구를 정리할 것');
});

test('[실제 문서] RUNBOOK §4 가 약속한 "값은 커밋하지 않는다" 원칙 문구가 살아 있다', () => {
  // 이 가드의 전제다. 문구가 사라지면 가드의 의미도 재검토해야 한다.
  const sec = runbookSection4(fs.readFileSync(path.join(ROOT, 'RUNBOOK.md'), 'utf8'));
  assert.match(sec, /값 자체는 이 저장소에 커밋하지 않는다/);
});

test('[실제 저장소] .env 가 git 추적에서 제외돼 있다 ⬅ 들어가면 시크릿이 공개 저장소에 실린다', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const lines = gi.split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('.env') || lines.includes('.env*') || lines.includes('*.env'),
    '.gitignore 에 .env 규칙이 없다');
});
