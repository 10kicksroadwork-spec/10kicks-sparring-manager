import { describe, expect, it } from "vitest";
import {
  explainSkillLimits,
  explainWeightLimits,
  partnerWeightRangeLbs,
  skillBand,
} from "@/lib/domain/limit-explanations";

describe("partnerWeightRangeLbs", () => {
  it("intersects absolute lb and percent-of-lighter constraints", () => {
    // 120 lb, 60 lb and 50%: both allow up to 180
    expect(partnerWeightRangeLbs(120, 60, 50)).toEqual({ minLbs: 80, maxLbs: 180 });
  });

  it("lets the tighter rule win on the high side", () => {
    // 200 lb, 60 lb → 260; 50% → 300; intersection max is 260
    expect(partnerWeightRangeLbs(200, 60, 50).maxLbs).toBe(260);
  });

  it("lets the tighter rule win on the low side", () => {
    // 120 lb, 15 lb → min 105; 10% → min 120/1.1 ≈ 109.09; intersection uses pct
    const range = partnerWeightRangeLbs(120, 15, 10);
    expect(range.minLbs).toBeCloseTo(120 / 1.1, 5);
    expect(range.maxLbs).toBeCloseTo(Math.min(135, 132), 5);
  });
});

describe("skillBand", () => {
  it("clamps to the 1–7 skill scale", () => {
    expect(skillBand(1, 3)).toEqual({ minSkill: 1, maxSkill: 4 });
    expect(skillBand(7, 2)).toEqual({ minSkill: 5, maxSkill: 7 });
    expect(skillBand(4, 0)).toEqual({ minSkill: 4, maxSkill: 4 });
  });
});

describe("live explanations from checked-in fighters", () => {
  const fighters = [
    { displayName: "Heavy", weightLbs: 200, skill: 5 },
    { displayName: "Light", weightLbs: 120, skill: 2 },
    { displayName: "Mid", weightLbs: 160, skill: 4 },
  ];

  it("uses the lightest fighter for the weight example", () => {
    const explanation = explainWeightLimits(fighters, {
      maxWeightDifferenceLbs: 60,
      maxWeightDifferencePctOfLighterAthlete: 50,
    });
    expect(explanation?.athleteName).toBe("Light");
    expect(explanation?.athleteWeightLbs).toBe(120);
    expect(explanation?.minPartnerLbs).toBe(80);
    expect(explanation?.maxPartnerLbs).toBe(180);
    expect(explanation?.text).toContain("Light");
    expect(explanation?.text).toContain("120");
  });

  it("uses the lowest-skill fighter for the skill example", () => {
    const explanation = explainSkillLimits(fighters, { maxSkillDifference: 3 });
    expect(explanation?.athleteName).toBe("Light");
    expect(explanation?.athleteSkill).toBe(2);
    expect(explanation?.minSkill).toBe(1);
    expect(explanation?.maxSkill).toBe(5);
    expect(explanation?.text).toContain("skill 1–5");
  });

  it("returns null when nobody is checked in as a fighter", () => {
    expect(explainWeightLimits([], { maxWeightDifferenceLbs: 60, maxWeightDifferencePctOfLighterAthlete: 50 })).toBeNull();
    expect(explainSkillLimits([], { maxSkillDifference: 3 })).toBeNull();
  });
});
