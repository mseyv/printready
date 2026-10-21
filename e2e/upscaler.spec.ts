import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function fixture(width: number, height: number) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 251;
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

async function upload(page: Page, width = 192, height = 108) {
  await page.goto("/");
  await expect(page.getByText(/Drag an image here/).first()).toBeAttached();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "test photo.jpg",
    mimeType: "image/jpeg",
    buffer: await fixture(width, height),
  });
  await expect(page.getByText(`${width} × ${height} px`).first()).toBeVisible();
}

const widthInput = (page: Page) => page.getByLabel("Final width");
const heightInput = (page: Page) => page.getByLabel("Final height");

test("detects dimensions and defaults to ×2", async ({ page }) => {
  await upload(page);
  await expect(page.getByRole("radio", { name: /×2/ })).toBeChecked();
  await expect(widthInput(page)).toHaveValue("384");
  await expect(heightInput(page)).toHaveValue("216");
  await expect(page.getByText("Exactly ×2 of the original")).toBeVisible();
});

test("switching to ×4 updates output dimensions and print size", async ({ page }) => {
  await upload(page);
  await page.getByText("×4", { exact: true }).click();
  await expect(widthInput(page)).toHaveValue("768");
  await expect(heightInput(page)).toHaveValue("432");
  // 768 px / 300 DPI = 2.56 in = 6.5 cm
  await expect(page.getByText("6.5 × 3.66 cm")).toBeVisible();
  await page.getByRole("radio", { name: /72 DPI/ }).check({ force: true });
  await expect(page.getByText("27.09 × 15.24 cm")).toBeVisible();
});

test("aspect lock recalculates; unlocking edits independently; custom size is flagged", async ({ page }) => {
  await upload(page);
  await widthInput(page).fill("300");
  await expect(heightInput(page)).toHaveValue("169");
  await expect(page.getByText("Custom size", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /×2/ })).toBeChecked(); // preset not silently changed

  await page.getByRole("button", { name: /Aspect ratio locked/ }).click();
  await heightInput(page).fill("200");
  await expect(widthInput(page)).toHaveValue("300");
  await expect(page.getByText(/stretched/)).toBeVisible();

  await page.getByRole("button", { name: /Reset to ×2/ }).click();
  await expect(widthInput(page)).toHaveValue("384");
  await expect(heightInput(page)).toHaveValue("216");
});

test("rejects unsupported files with a clear message", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Drag an image here/).first()).toBeAttached();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "Unsupported" })).toContainText("Unsupported file type");
});

test("shows limit errors and disables processing", async ({ page }) => {
  await upload(page);
  await widthInput(page).fill("5000");
  await expect(page.getByText(/AI engine supports up to ×4/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Upscale Image" })).toBeDisabled();
});

test("layout: two columns on desktop, stacked without horizontal scroll on mobile", async ({ page }, info) => {
  await upload(page);
  const settings = await page.getByRole("heading", { name: "Upscale factor" }).boundingBox();
  const preview = await page.getByRole("region", { name: "Preview and results" }).boundingBox();
  expect(settings && preview).toBeTruthy();
  if (info.project.name === "desktop") {
    expect(preview!.x).toBeGreaterThan(settings!.x + 300);
  } else {
    expect(preview!.y).toBeGreaterThan(settings!.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("processes with the configured AI engine, compares and downloads", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  test.skip(!config.engine.configured, "No AI engine configured");

  await upload(page, 96, 64);
  await page.getByRole("radio", { name: /150 DPI/ }).check({ force: true });
  await page.getByRole("button", { name: "Upscale Image" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByText("Upscaled and verified")).toBeVisible({ timeout: 150_000 });

  const slider = page.getByRole("slider", { name: "Comparison divider" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download PNG/ }).click()]);
  expect(download.suggestedFilename()).toBe("test-photo_upscaled-2x_192x128_150dpi.png");
  const meta = await sharp(await download.path()).metadata();
  expect(meta).toMatchObject({ width: 192, height: 128, density: 150, format: "png" });
});
