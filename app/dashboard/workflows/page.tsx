import { WorkflowGallery } from "@/components/proof-layer/WorkflowGallery";
import { getWorkflowGalleryItems } from "@/lib/proof-layer/examples";

export default function WorkflowsPage() {
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Workflow Gallery</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Read-only workflow proof examples. Select a workflow to inspect nodes, edges, model/provider visibility,
          evals, tools, permission classes, approval gates, and artifacts.
        </p>
      </div>
      <WorkflowGallery items={getWorkflowGalleryItems()} />
    </main>
  );
}
