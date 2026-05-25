import { expect, test } from '@playwright/test';
import { resolveFirstTaskId, resolvePlanId } from '../helpers/ids';

test('task comments — post, edit, delete', async ({ page, request }) => {
  const planId = await resolvePlanId(request, 'Engineering', 'Q2 Infrastructure');
  const taskId = await resolveFirstTaskId(request, planId);

  await page.goto(`/planner/plans/${planId}/tasks/${taskId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const commentsSection = page.getByRole('region', { name: 'Comments' });
  await expect(commentsSection).toBeVisible();

  // Use a uniquely-suffixed body so the assertions stay stable even if the
  // task already has other comments from a previous run.
  const stamp = `e2e-${Date.now()}`;
  const body = `hello ${stamp}`;
  const edited = `hello ${stamp} (edited)`;

  // Expand composer and post.
  await commentsSection.getByRole('button', { name: /write a comment/i }).click();
  await commentsSection.getByPlaceholder(/write a comment/i).fill(body);
  await commentsSection.getByRole('button', { name: 'Post' }).click();
  const posted = commentsSection.getByText(body, { exact: false });
  await expect(posted).toBeVisible();

  // Edit via the comment's "Comment actions" menu.
  const article = commentsSection.locator('article').filter({ hasText: body }).first();
  await article.getByRole('button', { name: 'Comment actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = article.getByRole('textbox');
  await editor.fill(edited);
  await article.getByRole('button', { name: 'Save' }).click();
  await expect(commentsSection.getByText(edited, { exact: false })).toBeVisible();

  const editedArticle = commentsSection.locator('article').filter({ hasText: edited }).first();
  await expect(editedArticle.getByText('edited', { exact: false })).toBeVisible();

  // Delete via the same menu.
  await editedArticle.getByRole('button', { name: 'Comment actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(commentsSection.getByText(edited, { exact: false })).toHaveCount(0);
});
