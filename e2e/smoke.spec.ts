import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Apply the exact CSP from netlify.toml to the locally served build, so CSP
// violations are caught in CI instead of after deploy.
const toml = readFileSync('netlify.toml', 'utf8')
const csp = /Content-Security-Policy\s*=\s*"([^"]+)"/.exec(toml)?.[1]

test('app loads under the netlify.toml CSP with no console violations', async ({
  page,
}) => {
  expect(csp).toBeTruthy()
  await page.route('**/*', async (route) => {
    const res = await route.fetch()
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'content-security-policy': csp! },
    })
  })

  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Daedalus IDE' })).toBeVisible()
  expect(problems).toEqual([])
})
