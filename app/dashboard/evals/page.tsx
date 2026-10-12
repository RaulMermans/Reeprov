import { EvalStudioView } from "@/components/proof-layer/EvalStudioView";

export const metadata = {
  title: "Eval Studio | AgentPulse",
  description: "Deterministic and model-based evaluations for agent reliability and regression protection.",
};

export default function EvalStudioPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <EvalStudioView />
    </div>
  );
}
