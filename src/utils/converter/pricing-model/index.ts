import { AgentFixedPricing, AgentPricing, UnitValue } from '@prisma/client';

export function convertAgentPricingDBToAgentPricing(
  agentPricing: AgentPricing & {
    AgentFixedPricing: AgentFixedPricing & { Amounts: UnitValue[] };
  },
) {
  return {
    id: agentPricing.id,
    createdAt: agentPricing.createdAt,
    updatedAt: agentPricing.updatedAt,
    type: agentPricing.pricingType,
    amounts: agentPricing.AgentFixedPricing.Amounts.map((amount) => ({
      unit: amount.unit,
      amount: amount.amount.toString(),
    })),
  };
}
