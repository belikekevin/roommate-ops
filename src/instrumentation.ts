export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "1") {
    const { startScheduler } = await import("./jobs/scheduler");
    startScheduler();
  }
}
