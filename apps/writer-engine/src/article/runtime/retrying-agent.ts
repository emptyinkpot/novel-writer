export type RetryingAgentOptions<T> = {
  /** Stage label used in progress events and the exhaustion error. */
  label: string;
  /** Max attempts before throwing. */
  maxAttempts: number;
  /** Produce the candidate output; `feedback` is '' on the first attempt and the
   *  buildFeedback(...) result on every retry. */
  attempt: (feedback: string, attemptNumber: number) => Promise<string>;
  /** Throw with a specific reason if the candidate is unacceptable; return normally if ok. */
  validate: (output: string) => void;
  /** Turn the last failure reason into corrective feedback injected into the next attempt. */
  buildFeedback: (lastError: string, attemptNumber: number) => string;
  /** Progress reporter (stage, message). */
  report?: (event: { stage: string; message: string }) => void;
};

/**
 * One shared retry-with-feedback loop for the non-deterministic writing agents
 * (final-editor, revision, enrichment). Replaces three divergent hand-rolled loops
 * that disagreed on attempt count, feedback shape, and — critically — whether to throw
 * on exhaustion (enrichment used to swallow and let a downstream check mis-report which
 * stage failed). Semantics here are uniform and honest: validate every candidate, feed
 * the specific deviation back, and throw a labeled error after maxAttempts. No swallow,
 * no loosened validation.
 */
export async function runRetryingAgent<T = string>(options: RetryingAgentOptions<T>): Promise<string> {
  const { label, maxAttempts, attempt, validate, buildFeedback, report } = options;
  const emit = report || (() => {});
  let feedback = '';
  let lastError = '';
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      const output = await attempt(feedback, attemptNumber);
      validate(output);
      return output;
    } catch (error) {
      // Any failure this round — the agent call itself throwing (e.g. enrichment
      // "no applicable insertions") OR the validator rejecting the output — feeds the
      // deviation back and retries. Exhaustion throws a single labeled error.
      lastError = error instanceof Error ? error.message : String(error);
    }
    feedback = buildFeedback(lastError, attemptNumber);
    emit({ stage: `${label}_retry`, message: `attempt ${attemptNumber} failed: ${lastError}; retrying with feedback` });
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts: ${lastError}`);
}
