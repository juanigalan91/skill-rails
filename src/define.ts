// The TypeScript format of a rails file: `export default defineRails({ name, inputs, run })` in rails.ts.
// The runner replays run on each call: a step that has a result returns it, and the first agent step with no result stops the run.
import type { InputSpec, Option } from './types.js';

type Trim<S extends string> = S extends ` ${infer R}` ? Trim<R> : S extends `${infer R} ` ? Trim<R> : S;
type Choices<S extends string> = S extends `${infer A}|${infer B}` ? Trim<A> | Choices<B> : Trim<S>;
type Scalar<S extends string> = Trim<S> extends 'string' ? string
  : Trim<S> extends 'number' | 'integer' ? number
  : Trim<S> extends 'boolean' ? boolean
  : Trim<S> extends 'any' | 'object' | 'array' ? unknown
  : S extends `${string}|${string}` ? Choices<S>
  : string;
type Optional<K, V> = K extends `${string}?` ? true : V extends `${string}?` ? true : false;
type Key<K> = K extends `${infer N}?` ? N : K;

/** The type of a JSON Schema: its type, items and properties. */
type Schema<T> = T extends { enum: ReadonlyArray<infer E> } ? E
  : T extends { type: 'array'; items: infer I } ? Array<Schema<I>>
  : T extends { type: 'object'; properties: infer P } ? { [K in keyof P]: Schema<P[K]> }
  : T extends { type: infer X extends string } ? Scalar<X>
  : unknown;

/** The type of a value of the short output form: `string`, `a | b`, `[string]`, a nested map, `?` for optional, or a JSON Schema. */
export type Field<T> = T extends `${infer U}?` ? Field<U>
  : T extends string ? Scalar<T>
  : T extends readonly [infer E] ? Array<Field<E>>
  : T extends { type: unknown } | { enum: unknown } ? Schema<T>
  : T extends object ? Output<T>
  : unknown;

/** The type of an output in the short form; a full JSON Schema gives unknown values. */
export type Output<S> = { [K in keyof S as Optional<K, S[K]> extends true ? never : Key<K>]: Field<S[K]> } & {
  [K in keyof S as Optional<K, S[K]> extends true ? Key<K> : never]?: Field<S[K]>;
} extends infer O ? { [K in keyof O]: O[K] } : never;

type InputType<S> = S extends { type: 'boolean' } ? boolean : S extends { type: 'number' } ? number : S extends { type: 'list' } ? string[] : string;
export type Inputs<I> = { [K in keyof I]: InputType<I[K]> };

export interface ShOptions {
  /** The step id, so that a prompt can read `steps.<id>.outputs`; the default is sh-<call number>. */
  id?: string;
  /** The folder of the command, relative to the project. */
  cwd?: string;
  env?: Record<string, unknown>;
  /** The time limit of the command; the default is 10 minutes. */
  timeoutMinutes?: number;
}

/** Runs a shell command and gives its trimmed stdout. The values of a tagged template are quoted, so they cannot inject shell code. */
export interface Sh {
  (command: string): string;
  (strings: TemplateStringsArray, ...values: unknown[]): string;
  /** The stdout, parsed as JSON. */
  json<T = Record<string, unknown>>(strings: TemplateStringsArray | string, ...values: unknown[]): T;
  /** The stdout, one JSON value per line. */
  jsonl<T = unknown>(strings: TemplateStringsArray | string, ...values: unknown[]): T[];
  /** The stdout, read as KEY=value lines. */
  env(strings: TemplateStringsArray | string, ...values: unknown[]): Record<string, string>;
  /** The same command with a step id, a folder or environment variables. */
  with(options: ShOptions): Sh;
}

export interface AgentOptions<S> {
  /** Named values that the agent gets as YAML after the instructions. */
  with?: Record<string, unknown>;
  /** The output schema: the short form (`{ kind: 'fix | skip', note: 'string' }`) or a JSON Schema. */
  output?: S;
  /** The folder where the agent does the step, relative to the project. */
  directory?: string;
}

export interface AskQuestion {
  question: string;
  /** A short label; the default is the step id. */
  header?: string;
  options?: ReadonlyArray<Option | string>;
  multiSelect?: boolean;
  /** The user answers with free text; the options are then suggestions. */
  free?: boolean;
  /** The user can type an answer that is not an option. */
  other?: boolean;
}

type OptionValue<O> = O extends { value: infer V } ? V : O extends { label: infer L } ? L : O extends string ? O : never;
type Choice<Q> = Q extends { free: true } | { other: true } ? string : Q extends { options: ReadonlyArray<infer O> } ? OptionValue<O> : string;
/** The answer of a question: the value or the label of the option, a list for multiSelect, any text for free or other. */
export type Answer<Q> = Q extends { multiSelect: true } ? Array<Choice<Q>> : Choice<Q>;
type Result<S> = [S] extends [undefined] ? Record<string, unknown> : Output<S>;

export interface RailsContext<I> {
  inputs: Inputs<I>;
  /** The folder of the rails file. */
  dir: string;
  sh: Sh;
  /** The agent follows the instructions (a text, or the path of a Markdown file relative to rails.ts) and reports the output. */
  prompt<const S = undefined>(id: string, instructions: string, options?: AgentOptions<S>): Result<S>;
  /** The agent runs another skill, then follows the optional prompt. */
  skill<const S = undefined>(id: string, name: string, options?: AgentOptions<S> & { args?: string; prompt?: string }): Result<S>;
  /** The agent asks the user one question and gives the value (or the label) of the answer. */
  ask<const Q extends AskQuestion>(id: string, question: Q): Answer<Q>;
  /** The agent asks several questions in one step and gives the answers by key; an undefined question is not asked. */
  ask<const M extends Record<string, AskQuestion | undefined | false>>(id: string, questions: M): { [K in keyof M]: M[K] extends AskQuestion ? Answer<M[K]> : Answer<Exclude<M[K], undefined | false>> | undefined };
  /** Runs another rails file (`skill:<plugin>:<skill>`, or a path relative to rails.ts) with its inputs, and gives its outputs. */
  uses<T = Record<string, unknown>>(id: string, rails: string, inputs?: Record<string, unknown>): T;
  /** A message for the user, in the next report. */
  note(message: string): void;
}

/** What run returns: the message of the end, or the message with the outputs, or a failure. */
export type RailsResult = string | void | { message?: string; outputs?: Record<string, unknown>; fail?: string };

export interface RailsDefinition<I extends Record<string, InputSpec> = Record<string, InputSpec>> {
  name: string;
  description?: string;
  inputs?: I;
  /** The steps, as code. It must be deterministic: side effects go through sh and the agent steps, so that a replay takes the same path. */
  run(context: RailsContext<I>): RailsResult;
}

/**
 * A step that failed: a command with a non-zero exit code, an agent --fail, or a failed nested run.
 * It is thrown again at each replay, so that code can catch it. Read its fields; instanceof can fail, because the runner and rails.ts can load this module two times.
 */
export class StepError extends Error {
  constructor(
    readonly id: string,
    message: string,
    readonly exitCode?: number,
    /** The last lines of the stderr of a failed command. */
    readonly stderr?: string,
    /** The outputs of the failed step: what a command printed, or the outputs of a nested run. */
    readonly outputs?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function defineRails<const I extends Record<string, InputSpec> = Record<string, InputSpec>>(rails: RailsDefinition<I>): RailsDefinition<I> {
  return rails;
}
