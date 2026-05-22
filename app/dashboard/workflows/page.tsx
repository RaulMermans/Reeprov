import Link from "next/link";
import { WorkflowGallery } from "@/components/proof-layer/WorkflowGallery";
import { getWorkflowGalleryItems } from "@/lib/proof-layer/examples";

export default function WorkflowsPage() {
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <Link className="text-sm font-medium text-teal-700 hover:text-teal-900" href="/dashboard">Dashboard</Link>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">Workflow Gallery</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Read-only workflow proof layer examples. Select a workflow to inspect nodes, edges, model/provider visibility,
          evals, tools, permission classes, approval gates, and artifacts.
        </p>
      </div>
      <WorkflowGallery items={getWorkflowGalleryItems()} />
    </main>
  );
}
