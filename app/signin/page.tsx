import { Suspense } from "react";
import { redirect } from "next/navigation";
import { authRequired } from "@/lib/env";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  if (!authRequired()) redirect("/dashboard");
  return (
    <Suspense fallback={<p className="p-6">Loading sign in…</p>}>
      <SignInForm />
    </Suspense>
  );
}
