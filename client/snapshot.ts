import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { strataSnapshot } from "../shared/strata";

const BUSY_MS = 1000;
const IDLE_MS = 3000;

/** One shared query (same key) for the sidebar row and the screen: a single poll feeds both. */
export function useStrata() {
  const snapshot = useRpc(strataSnapshot);
  return useQuery({
    queryKey: ["strata-snapshot"],
    queryFn: () => snapshot({}),
    refetchInterval: (query) => (query.state.data?.state === "generating" ? BUSY_MS : IDLE_MS),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
