import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 360, 390, 430, 1280];

async function signIn(page: Page) {
  const response = await page.request.post("/api/test/session", {
    data: { email: "coach@10kicks.test" },
    headers: { origin: "http://127.0.0.1:3210", "x-requested-with": "sparring-manager" },
  });
  expect(response.ok()).toBeTruthy();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("sign-in fits phone and desktop widths", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 720 });
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sparring Manager" })).toBeVisible();
    const button = page.getByRole("button", { name: "Sign in with Google" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(/not a safety certification/i)).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

test("unsigned dashboard returns to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin/);
});

test("coach checks in, generates, locks, completes, and reprints", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const headers = { origin: "http://127.0.0.1:3210", "x-requested-with": "sparring-manager" };
  for (let index = 1; index <= 5; index += 1) {
    const created = await page.request.post("/api/athletes", {
      headers,
      data: { requestId: `e2e-f-${index}-${Date.now()}`, displayName: `Demo Fighter ${index}`, weightLbs: 160, skill: 3, aggression: 3, roleEligibility: "FIGHTER" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  for (let index = 1; index <= 14; index += 1) {
    const created = await page.request.post("/api/athletes", {
      headers,
      data: { requestId: `e2e-v-${index}-${Date.now()}`, displayName: `Demo Volunteer ${index}`, weightLbs: 160, skill: 3, aggression: 3, roleEligibility: "VOLUNTEER" },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  await page.goto("/dashboard");
  await expect(page.getByTestId("start-saturday")).toBeVisible();
  const startBox = await page.getByTestId("start-saturday").boundingBox();
  expect(startBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noHorizontalOverflow(page);
  await page.getByTestId("start-saturday").click();
  await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
  await expect(page).toHaveURL(/\/attendance/);
  const attendanceUrl = page.url();
  await expect(page.getByText(/revision [1-9]/)).toBeVisible();

  const boxes = page.locator('input[type="checkbox"]');
  const count = await boxes.count();
  expect(count).toBe(19);
  for (let index = 0; index < count; index += 1) {
    const box = boxes.nth(index);
    await box.click();
    await expect(box).toBeChecked();
  }

  await page.getByTestId("walkin-name").fill("Demo Walk-In");
  await page.getByTestId("walkin-weight").fill("160");
  await page.getByLabel("Walk-in skill").fill("3");
  await page.getByLabel("Walk-in aggression").fill("3");
  await page.getByTestId("add-volunteer").click();
  await expect(page.getByText("Demo Walk-In is checked in.")).toBeVisible();
  await page.getByTestId("generate-rundown").click();
  await expect(page.getByTestId("block-6")).toBeVisible();
  await expect(page.getByTestId("block-1")).toBeVisible();

  const removable = (await page.getByTestId("block-2").locator('[data-testid^="match-"]').first().innerText()).split(" / ")[1]?.trim();
  expect(removable).toBeTruthy();
  const lock = page.locator('[data-testid^="lock-"]').last();
  const lockId = await lock.getAttribute("data-testid");
  await lock.click();
  await expect(page.getByTestId(lockId ?? "")).toHaveText("Unlock match");
  await page.getByTestId("complete-block-1").click();
  await expect(page.getByTestId("block-1")).toContainText("Completed · both rounds");
  const completed = await page.getByTestId("block-1").innerText();
  const lockedArticle = page.getByTestId(lockId ?? "").locator("xpath=ancestor::article");
  const lockedText = (await lockedArticle.innerText()).replace(/\s+/g, " ").trim();

  await page.getByRole("link", { name: "Back to check-in" }).click();
  await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
  const volunteerBox = page.getByRole("checkbox", { name: new RegExp(`^${removable} `) });
  await volunteerBox.click();
  await expect(volunteerBox).not.toBeChecked();

  await page.getByRole("link", { name: "Session limits" }).click();
  await expect(page.getByText(/pending coach safety review/i)).toBeVisible();
  await page.goto(attendanceUrl.replace("/attendance", "/rundown"));
  await page.getByTestId("regenerate").click();
  await expect(page.getByText("Remaining matches rebuilt. Completed and locked matches stayed.")).toBeVisible();
  expect(await page.getByTestId("block-1").innerText()).toBe(completed);
  expect((await lockedArticle.innerText()).replace(/\s+/g, " ").trim()).toBe(lockedText);

  await page.getByRole("link", { name: "Print" }).click();
  await expect(page.getByTestId("print-rundown")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hard sparring rundown" })).toBeVisible();
  await noHorizontalOverflow(page);
});
