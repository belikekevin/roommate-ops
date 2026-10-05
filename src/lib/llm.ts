// Neon AI Gateway via Mastra's model router: "neon/<id>" reads NEON_AI_GATEWAY_BASE_URL + NEON_AI_GATEWAY_TOKEN.
// Model ids must be in the branch catalog: curl "$NEON_AI_GATEWAY_BASE_URL/v1/models" -H "Authorization: Bearer $NEON_AI_GATEWAY_TOKEN"
export const model = `neon/${process.env.LLM_MODEL ?? "claude-sonnet-5"}` as const;
