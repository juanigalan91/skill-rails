export type JsonObject = { [key: string]: unknown };

export interface InputSpec {
  type?: 'string' | 'boolean' | 'number';
  default?: string | boolean | number;
  required?: boolean;
  description?: string;
}

export type Condition = string | boolean;

interface BaseStep {
  id?: string;
  if?: Condition;
}

export interface RunStep extends BaseStep {
  run: string;
  env?: Record<string, unknown>;
  'continue-on-error'?: boolean;
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

export interface UsesStep extends BaseStep {
  id: string;
  /** The flow file, relative to the flow that uses it. */
  uses: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
  /** The loaded flow. */
  flow?: Flow;
}

export interface SkillStep extends BaseStep {
  id: string;
  skill: string;
  with?: string;
  prompt?: string;
  'prompt-file'?: string;
  output?: JsonObject;
}

export interface PromptStep extends BaseStep {
  id: string;
  prompt?: string;
  'prompt-file'?: string;
  output?: JsonObject;
}

export interface Option {
  label: string;
  description: string;
  /** Text that the question tool shows next to the option, for example a draft to approve. */
  preview?: string;
}

export interface Question {
  id: string;
  if?: Condition;
  question: string;
  header: string;
  multiSelect?: boolean;
  /** The user answers with free text; the options are then suggestions. */
  free?: boolean;
  /** An option, or an expression that gives a list of options. */
  options?: Array<Option | string>;
}

export interface AskStep extends BaseStep {
  id: string;
  ask: Question[];
}

export interface StopStep extends BaseStep {
  stop: string;
  outcome?: 'success' | 'failure';
}

export interface BreakStep extends BaseStep {
  break: true;
}

export type Step = RunStep | SkillStep | PromptStep | AskStep | StopStep | ForeachStep | UsesStep | BreakStep;
export type StepKind = 'run' | 'skill' | 'prompt' | 'ask' | 'stop' | 'foreach' | 'uses' | 'break';

export interface Flow {
  name: string;
  description?: string;
  inputs: Record<string, InputSpec>;
  steps: Step[];
  /** The folder of the flow file. */
  dir: string;
}

export type InputValue = string | number | boolean | null;

export interface StepResult {
  outcome: 'success' | 'failure' | 'skipped';
  exitCode?: number;
  outputs?: Record<string, unknown>;
}

export interface RenderedQuestion {
  id: string;
  question: string;
  header: string;
  multiSelect: boolean;
  free: boolean;
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
  /** Earliest time to resume a polling step, in Unix milliseconds. */
  retryAt?: number;
}

/** A running list of steps: the root flow, a sub-flow, or one iteration of a foreach. */
export interface Frame {
  kind: 'root' | 'flow' | 'foreach';
  /** The id of the step that started the frame (none for the root). */
  id?: string;
  name: string;
  dir: string;
  steps: Step[];
  index: number;
  inputs: Record<string, InputValue>;
  results: Record<string, StepResult>;
  /** foreach: the items, the current position, and the results of the finished iterations. */
  items?: unknown[];
  position?: number;
  iterations?: Array<{ item: unknown; steps: Record<string, StepResult> }>;
  /** run steps with until: when the polling started. */
  pollStarted?: number;
  pollNextAt?: number;
}

export interface State {
  flow: Flow;
  cwd: string;
  /** The root frame first. */
  frames: Frame[];
  notes: string[];
  status: 'running' | 'done' | 'failed';
  pending: PendingStep | null;
  message: string | null;
}

export interface Context {
  inputs: Record<string, InputValue>;
  steps: Record<string, StepResult>;
  env: Record<string, string | undefined>;
  flow: { name: string; dir: string };
  item: unknown;
  loop: { index: number; count: number } | null;
}

export interface RunOptions {
  env?: Record<string, unknown>;
  dir: string;
  cwd: string;
  timeoutMs?: number;
}

export interface RunResult {
  outcome: 'success' | 'failure';
  exitCode: number;
  outputs: Record<string, string>;
  warnings: string[];
  stderr: string;
}

export type Exec = (command: string, options: RunOptions) => RunResult;

/** What the agent reads after each command. */
export type Report = (
  | ({ status: 'step'; flow: string; notes?: string[] } & PendingStep)
  | { status: 'done' | 'failed' | 'running'; flow: string; message: string | null; notes?: string[] }
  | { status: 'invalid'; id: string; errors: string[]; output?: JsonObject }
  | { status: 'error'; errors: string[] }
  | { status: 'ok'; flow: string; steps: number }
  | { status: 'reset'; flow: string }
) & { cwd?: string };
