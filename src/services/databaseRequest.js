// Bound the whole request, including Supabase's wait for its authentication lock.
// The abort signal also prevents a delayed request from starting after the deadline.
export async function databaseRequest(request, timeoutMs = 20000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      request.abortSignal(controller.signal),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({
            data: null,
            error: { code: "57014", message: "Délai de réponse dépassé." },
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
