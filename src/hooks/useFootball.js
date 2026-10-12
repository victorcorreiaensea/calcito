import { useEffect, useState } from "react";
import { footballService } from "../services/footballService";

export function useFootball(method, params, { enabled = true } = {}) {
  const key = JSON.stringify(params);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    loading: enabled,
    result: null,
    error: null,
    requestKey: null,
  });
  const requestKey = `${method}:${key}:${revision}`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState({ loading: true, result: null, error: null, requestKey });
    footballService
      .get(method, key === undefined ? undefined : JSON.parse(key))
      .then((result) => {
        if (active)
          setState({ loading: false, result, error: null, requestKey });
      })
      .catch((error) => {
        if (active)
          setState({ loading: false, result: null, error, requestKey });
      });
    return () => {
      active = false;
    };
  }, [method, key, enabled, requestKey]);
  const current =
    enabled && state.requestKey === requestKey
      ? state
      : { loading: enabled, result: null, error: null };
  return {
    ...current,
    retry: () => {
      footballService.clearCache();
      setRevision((value) => value + 1);
    },
  };
}
