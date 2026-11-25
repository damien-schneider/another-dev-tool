import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@ctrl-ui/react/ui/alert";
import { Button } from "@ctrl-ui/react/ui/button";
import { useState } from "react";

import type { AgentAuthMethod, AgentSignIn } from "@/lib/agent-ipc-types";
import { toIpcError } from "@/lib/ipc";

export function StartFailedNotice({
  name,
  message,
  onRetry,
}: {
  name: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert tone="danger">
      <AlertTitle>{name} couldn’t start</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button onClick={onRetry} size="sm" variant="surface">
          Try again
        </Button>
      </AlertAction>
    </Alert>
  );
}

type Step =
  | { kind: "choosing" }
  | { kind: "waiting" }
  | { kind: "inTerminal" }
  | { kind: "failed"; message: string };

function explain(step: Step, name: string, methods: AgentAuthMethod[]) {
  switch (step.kind) {
    case "waiting":
      return `Finish signing in where ${name} sent you.`;
    case "inTerminal":
      return "A Terminal window opened to sign you in. Finish there, then continue.";
    case "failed":
      return step.message;
    default:
      return methods.length === 0
        ? `Sign in from ${name}’s own command line tool, then continue.`
        : `${name} runs on your own account.`;
  }
}

export function SignInNotice({
  name,
  methods,
  signIn,
  onSignedIn,
}: {
  name: string;
  methods: AgentAuthMethod[];
  signIn: (methodId: string) => Promise<AgentSignIn>;
  onSignedIn: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "choosing" });
  const continues = step.kind === "inTerminal" || methods.length === 0;

  const finish = () => {
    setStep({ kind: "choosing" });
    onSignedIn();
  };

  const start = async (methodId: string) => {
    setStep({ kind: "waiting" });
    try {
      const result = await signIn(methodId);
      if (result === "done") {
        finish();
      } else {
        setStep({ kind: "inTerminal" });
      }
    } catch (cause) {
      setStep({ kind: "failed", message: toIpcError(cause).message });
    }
  };

  return (
    <Alert tone="warning">
      <AlertTitle>Sign in to {name}</AlertTitle>
      <AlertDescription>{explain(step, name, methods)}</AlertDescription>
      <AlertAction className="flex flex-wrap gap-2">
        {continues ? (
          <Button onClick={finish} size="sm" variant="surface">
            Continue
          </Button>
        ) : (
          methods.map((method) => (
            <Button
              disabled={step.kind === "waiting"}
              key={method.id}
              onClick={() => start(method.id)}
              size="sm"
              title={method.description ?? undefined}
              variant="surface"
            >
              {method.name}
            </Button>
          ))
        )}
      </AlertAction>
    </Alert>
  );
}
