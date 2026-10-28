import { describe, expect, it } from "vitest";
import {
  explainSkillLimits,
  explainWeightLimits,
  partnerWeightRangeLbs,
  skillBand,
} from "@/lib/domain/limit-explanations";

describe("partnerWeightRangeLbs", () => {
  it("uses absolute lb only (percent no longer intersects)", () => {
    expect(partnerWeightRangeLbs(120, 60)).toEqual({ minLbs: 60, maxLbs: 180 });
    expect(partnerWeightRangeLbs(200, 60)).toEqual({ minLbs: 140, maxLbs: 260 });
  });

  it("allows pairs that old percent-of-lighter would have blocked", () => {
    // 120 lb + 15 lb → 105–135; under a 10% rule the low side was ~109
    const range = partnerWeightRangeLbs(120, 15);
    expect(range.minLbs).toBe(105);
    expect(range.maxLbs).toBe(135);
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

  it("uses the lightest fighter for the weight example without percent language", () => {
    const explanation = explainWeightLimits(fighters, {
      maxWeightDifferenceLbs: 60,
    });
    expect(explanation?.athleteName).toBe("Light");
    expect(explanation?.athleteWeightLbs).toBe(120);
    expect(explanation?.minPartnerLbs).toBe(60);
    expect(explanation?.maxPartnerLbs).toBe(180);
    expect(explanation?.text).toContain("Light");
    expect(explanation?.text).toContain("120");
    expect(explanation?.text.toLowerCase()).not.toMatch(/%|percent|lighter person/);
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
    expect(explainWeightLimits([], { maxWeightDifferenceLbs: 60 })).toBeNull();
    expect(explainSkillLimits([], { maxSkillDifference: 3 })).toBeNull();
  });
});
