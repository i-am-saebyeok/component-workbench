// 영어 키워드 Gherkin의 구조와 시나리오 태그 검사. 시나리오를 실행하지 않고,
// 태그에서 component/variant 의미를 추론하지 않는다. 시나리오 태그는 안정 ID다.
const KEYWORD = /^(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios):(.*)$/;
const STEP = /^(?:(?:Given|When|Then|And|But)\s|\*\s)/;
export const TAG_PATTERN = /^@[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const OUTLINE = new Set(['Scenario Outline', 'Scenario Template']);
const SCENARIO = new Set(['Scenario', 'Example', ...OUTLINE]);

export type Scenario = { line: number; keyword: string; title: string; tags: string[] };
export type FeatureProblem = { line: number; message_ko: string };

type ScenarioState = Scenario & { steps: number; examples: boolean };
type Block = { kind: string; content: boolean; scenario?: ScenarioState | undefined };

export function parseFeature(text: string): { scenarios: Scenario[]; problems: FeatureProblem[] } {
  const problems: FeatureProblem[] = [];
  const scenarios: ScenarioState[] = [];
  const problem = (line: number, message_ko: string) => problems.push({ line, message_ko });
  let feature = false;
  let pendingTags: string[] = [];
  let block: Block | null = null;
  let docstring: string | null = null;
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const n = index + 1;
    const trimmed = line.trim();
    if (docstring) {
      if (trimmed.startsWith(docstring)) docstring = null;
      return;
    }
    if (trimmed === '') return;
    if (trimmed.startsWith('#')) {
      const language = /^#\s*language\s*:\s*(\S+)/.exec(trimmed);
      if (language && language[1] !== 'en') problem(n, `# language: ${language[1]}는 지원하지 않는다. 영어 Gherkin 키워드를 쓴다.`);
      return;
    }
    if (trimmed.startsWith('@')) {
      for (const token of trimmed.split(/\s+/)) {
        if (token.startsWith('#')) break;
        if (TAG_PATTERN.test(token)) pendingTags.push(token);
        else problem(n, `태그 ${token} 형식이 잘못됐다. @ 뒤에 영문·숫자로 시작하는 이름을 쓴다.`);
      }
      return;
    }

    const keyword = KEYWORD.exec(trimmed);
    if (keyword) {
      // 두 group은 정규식에서 항상 참여한다.
      const [, name = '', title = ''] = keyword;
      if (name === 'Feature') {
        if (feature) problem(n, 'Feature:는 파일에 한 번만 쓴다.');
        feature = true;
      } else if (!feature) {
        problem(n, `${name}: 앞에 Feature:가 없다.`);
      }
      if (SCENARIO.has(name)) {
        const scenario: ScenarioState = { line: n, keyword: name, title: title.trim(), tags: pendingTags, steps: 0, examples: false };
        scenarios.push(scenario);
        block = { kind: 'scenario', content: false, scenario };
      } else if (name === 'Examples' || name === 'Scenarios') {
        const scenario = block?.scenario;
        if (!scenario) problem(n, `${name}:가 Scenario Outline 밖에 있다.`);
        else scenario.examples = true;
        block = { kind: 'examples', content: false, scenario };
      } else {
        block = { kind: name.toLowerCase(), content: false };
      }
      pendingTags = [];
      return;
    }

    if (pendingTags.length > 0) {
      problem(n, '태그 다음 줄에는 Feature·Rule·Scenario·Examples 키워드가 와야 한다.');
      pendingTags = [];
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      if (!block?.content || (block.kind !== 'scenario' && block.kind !== 'background')) problem(n, 'docstring은 단계 바로 아래에만 쓴다.');
      docstring = trimmed.slice(0, 3);
      return;
    }
    if (STEP.test(trimmed)) {
      if (block?.kind === 'scenario' || block?.kind === 'background') {
        block.content = true;
        if (block.scenario) block.scenario.steps += 1;
      } else {
        problem(n, '단계(Given/When/Then/And/But)가 Scenario나 Background 밖에 있다.');
      }
      return;
    }
    if (trimmed.startsWith('|')) {
      if (block?.kind === 'examples' || ((block?.kind === 'scenario' || block?.kind === 'background') && block.content)) block.content = true;
      else problem(n, '표 줄은 단계 아래나 Examples 안에만 쓴다.');
      return;
    }
    // 키워드 바로 아래의 자유 설명은 허용하고, 단계나 표가 나온 뒤의 알 수 없는 줄은 거부한다.
    if (!block) problem(n, 'Feature: 앞에 알 수 없는 줄이 있다.');
    else if (block.content) problem(n, `알 수 없는 줄이다. 단계는 Given/When/Then/And/But으로 시작한다: ${trimmed}`);
  });

  if (docstring) problem(lines.length, 'docstring이 닫히지 않았다.');
  if (!feature) problem(1, 'Feature:가 없다.');
  if (feature && scenarios.length === 0) problem(1, 'Scenario가 하나도 없다.');
  for (const scenario of scenarios) {
    if (scenario.tags.length === 0) problem(scenario.line, `시나리오 "${scenario.title}"에 안정 ID 태그가 없다. 바로 위 줄에 @태그를 붙인다.`);
    if (scenario.steps === 0) problem(scenario.line, `시나리오 "${scenario.title}"에 단계가 없다.`);
    if (OUTLINE.has(scenario.keyword) && !scenario.examples) problem(scenario.line, `${scenario.keyword} "${scenario.title}"에 Examples가 없다.`);
  }
  return {
    scenarios: scenarios.map(({ line, keyword, title, tags }) => ({ line, keyword, title, tags })),
    problems: problems.sort((a, b) => a.line - b.line),
  };
}

export function scenarioIds(scenarios: Scenario[]): string[] {
  return [...new Set(scenarios.flatMap((scenario) => scenario.tags))];
}
