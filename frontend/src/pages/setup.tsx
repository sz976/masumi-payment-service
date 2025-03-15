import { SetupWelcome } from "@/components/setup/SetupWelcome";
import { useAppContext } from "@/lib/contexts/AppContext";
import { useRouter } from "next/router";
import { useEffect } from "react";

export default function SetupPage() {
  const { state } = useAppContext();
  const router = useRouter();

  useEffect(() => {
    if (!state.apiKey) {
      router.push('/');
    }
  }, [state.apiKey, router]);

  if (!state.apiKey) {
    return null;
  }

  return <SetupWelcome />;
} 