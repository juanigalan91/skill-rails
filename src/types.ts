export type JsonObject = { [key: string]: unknown };

export interface InputSpec {
  type?: 'string' | 'boolean' | 'number' | 'list';
  default?: string | boolean | number | string[];
  required?: boolean;
  description?: string;
  /** The allowed values: of the input, or of each item of a list. */
  enum?: string[];
}

export type Condition = string | boolean;

interface BaseStep {
  id?: string;
  if?: Condition;
}

export interface RunStep extends BaseStep {
  run: string;
  /** Arguments added to the command, each one quoted: a list item that is a list adds each of its items, and an empty item adds nothing.
   * A map item adds flags: true adds the flag, a list adds the flag before each item, another value adds the flag and the value.
   * One value that is not a list is one item. */
  args?: unknown;
  env?: Record<string, unknown>;
  /** Read the outputs from stdout: text (outputs.value), env (KEY=value lines), json (an object gives its keys; another value gives outputs.value) or jsonl (outputs.value is the list of the lines). */
  stdout?: 'text' | 'env' | 'json' | 'jsonl';
  /** Go on when the command fails; a list goes on only for these exit codes. */
  'continue-on-error'?: boolean | number[];
  /** The folder where the command runs, relative to the project. */
  'working-directory'?: string;
  /** Poll: run again until this condition is true. */
  until?: Condition;
  'interval-seconds'?: number;
  'timeout-minutes'?: number;
}

export interface ForeachStep extends BaseStep {
  id: string;
  /** An expression that gives a list, or a list. */
  foreach: string | unknown[];
  steps: Step[];
}

export interface RepeatStep extends BaseStep {
  id: string;
  repeat: {
    /** Checked after each iteration, with the results of that iteration: the loop ends when it is true. */
    until: Condition;
    'max-iterations'?: number;
  };
  steps: Step[];
}

export interface UsesStep extends BaseStep {
  id: string;
  /** The rails file, relative to the rails file that uses it. */
  uses: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
  /** A stop step of the other rails file also ends this one, with the same message and outcome. */
  'forward-stop'?: boolean;
  'working-directory'?: string;
  /** The loaded rails file. */
  rails?: Rails;
}

export interface SkillStep extends BaseStep {
  id: string;
  /** The folder where the agent does the step, relative to the project. */
  'working-directory'?: string;
  /** Go on when the agent reports that it cannot do the step. */
  'continue-on-error'?: boolean;
  skill: string;
  /** The arguments: a text, or a map of named values that the agent gets as YAML. */
  with?: string | Record<string, unknown>;
  prompt?: string;
  output?: JsonObject;
}

export interface PromptStep extends BaseStep {
  id: string;
  /** The folder where the agent does the step, relative to the project. */
  'working-directory'?: string;
  'continue-on-error'?: boolean;
  prompt?: string;
  /** Named values that the agent gets as YAML after the instructions. */
  with?: Record<string, unknown>;
  output?: JsonObject;
}

export interface Option {
  label: string;
  description: string;
  /** Text that the question tool shows next to the option, for example a draft to approve. */
  preview?: string;
  /** The value that the step output holds when the user selects this option; default the label. */
  value?: unknown;
}

export interface Question {
  id: string;
  if?: Condition;
  question: string;
  header: string;
  multiSelect?: boolean;
  /** The user answers with free text; the options are then suggestions. */
  free?: boolean;
  /** The user can also type another answer: the output is the label or the text. */
  other?: boolean;
  /** An option, or an expression that gives a list of options. */
  options?: Array<Option | string>;
}

export interface AskStep extends BaseStep {
  id: string;
  /** The questions, or an expression that gives them (a question with no id gets q1, q2...). */
  ask: Question[] | string;
  /** A dynamic ask: the most questions to ask; default 4. */
  max?: number;
  /** A dynamic ask: options added to each question that has options. */
  'extra-options'?: Option[];
}

export interface StopStep extends BaseStep {
  stop?: string;
  /** Short form of a stop with outcome failure. */
  fail?: string;
  outcome?: 'success' | 'failure';
}

export interface BreakStep extends BaseStep {
  break: true;
}

/** Shows a message to the user, and the run goes on. */
export interface NoteStep extends BaseStep {
  note: string;
}

/** Computes values with expressions, with their types: steps.<id>.outputs.<key>. */
export interface SetStep extends BaseStep {
  id: string;
  /** The values, or an expression that gives an object of values. */
  set: Record<string, unknown> | string;
}

export type Step = RunStep | SkillStep | PromptStep | AskStep | StopStep | NoteStep | SetStep | ForeachStep | RepeatStep | UsesStep | BreakStep;
export type StepKind = 'run' | 'skill' | 'prompt' | 'ask' | 'stop' | 'fail' | 'note' | 'set' | 'foreach' | 'repeat' | 'uses' | 'break';

export interface Rails {
  name: string;
  description?: string;
  inputs: Record<string, InputSpec>;
  steps: Step[];
  /** The values that the rails file gives back at its end: an object of expressions, or one expression that gives an object. */
  outputs?: Record<string, unknown> | string;
  /** Steps that run when the run fails, before the failed report. */
  'on-failure'?: Step[];
  /** The folder of the rails file. */
  dir: string;
  /** A TypeScript rails file: the path of its file, whose run function the runner replays. */
  code?: string;
}

export type InputValue = string | number | boolean | string[] | null;

export interface StepResult {
  outcome: 'success' | 'failure' | 'skipped';
  exitCode?: number;
  /** A failed run step: the last lines of its stderr. */
  error?: string;
  outputs?: Record<string, unknown>;
  /** An agent step: what the agent was asked. */
  request?: StepRequest;
  /** An agent step: the output as the agent reported it, or `{ $fail: reason }`. */
  answer?: unknown;
}

export type StepRequest = Pick<PendingStep, 'type' | 'instructions' | 'skill' | 'args' | 'questions' | 'directory'>;

export interface RenderedQuestion {
  id: string;
  question: string;
  header: string;
  multiSelect: boolean;
  free: boolean;
  other: boolean;
  options: Option[];
}

/** A step that waits for the agent. */
export interface PendingStep {
  id: string;
  type: 'skill' | 'prompt' | 'ask' | 'wait';
  skill?: string;
  args?: string;
  instructions?: string;
  questions?: RenderedQuestion[];
  output?: JsonObject;
  /** The folder to work in, when it is not the project. */
  directory?: string;
  /** ask: the value of each option label, by question id. */
  values?: Record<string, Record<string, unknown>>;
  /** Earliest time to resume a polling step, in Unix milliseconds. */
  retryAt?: number;
  /** ask: the answers of the user, by question id, that the host hook read from the question tool. */
  asked?: Record<string, unknown>;
}

/** A running list of steps: the root rails file, a nested rails file, or one iteration of a foreach or a repeat. */
export interface Frame {
  kind: 'root' | 'rails' | 'foreach' | 'repeat';
  /** The id of the step that started the frame (none for the root). */
  id?: string;
  name: string;
  dir: string;
  steps: Step[];
  index: number;
  inputs: Record<string, InputValue>;
  /** root and rails: the outputs of the rails file. */
  outputs?: Record<string, unknown> | string;
  /** root and rails: the failure steps, and the failure that runs them. */
  onFailure?: Step[];
  failure?: { message: string | null };
  /** rails: the folder where its commands and agent steps run, when it is not the project. */
  cwd?: string;
  results: Record<string, StepResult>;
  /** foreach: the items, the current position, and the results of the finished iterations. */
  items?: unknown[];
  /** repeat: the end condition and the maximum number of iterations. */
  until?: Condition;
  maxIterations?: number;
  position?: number;
  iterations?: Array<{ item: unknown; steps: Record<string, StepResult> }>;
  /** run steps with until: when the polling started. */
  pollStarted?: number;
  pollNextAt?: number;
}

export interface State {
  rails: Rails;
  /** The rails file, for record. */
  file?: string;
  cwd: string;
  /** The root frame first. */
  frames: Frame[];
  notes: string[];
  status: 'running' | 'done' | 'failed';
  pending: PendingStep | null;
  message: string | null;
  /** The outputs of the run, at its end. */
  outputs?: Record<string, unknown>;
  /** A TypeScript rails file: its steps in call order, with their results and nested runs, and the count of notes already given. */
  replay?: { calls: Array<{ id: string; result?: StepResult; child?: State }>; notes: number };
}

export interface LoopContext {
  index: number;
  number: number;
  count: number;
  previous: Record<string, StepResult> | null;
  /** The loop around this one. */
  parent: LoopContext | null;
}

export interface Context {
  inputs: Record<string, InputValue>;
  steps: Record<string, StepResult>;
  env: Record<string, string | undefined>;
  rails: { name: string; dir: string };
  item: unknown;
  /** In on-failure steps: the reason of the failure. */
  failure: { message: string | null } | null;
  /** previous: the step results of the last finished iteration. */
  loop: LoopContext | null;
}

export interface RunOptions {
  env?: Record<string, unknown>;
  args?: unknown[];
  stdout?: RunStep['stdout'];
  dir: string;
  cwd: string;
  timeoutMs?: number;
}

export interface RunResult {
  outcome: 'success' | 'failure';
  exitCode: number;
  outputs: Record<string, unknown>;
  warnings: string[];
  stderr: string;
}

export type Exec = (command: string, options: RunOptions) => RunResult;

/** What the agent reads after each command. */
export type Report = (
  | ({ status: 'step'; rails: string; notes?: string[] } & PendingStep)
  | { status: 'done' | 'failed' | 'running'; rails: string; message: string | null; outputs?: Record<string, unknown>; notes?: string[] }
  | { status: 'invalid'; id: string; errors: string[]; output?: JsonObject }
  | { status: 'error'; errors: string[] }
  | { status: 'ok'; rails: string; steps?: number }
  | { status: 'reset'; rails: string }
) & { cwd?: string; next?: string; /** start: how the agent acts on each result. */ protocol?: string };
