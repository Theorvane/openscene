import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release-promotion.yml'), 'utf8')

describe('release-promotion workflow', () => {
  it('permits only the repository-owned dev integration branch', () => {
    expect(workflow).toContain('HEAD_REF: ${{ github.head_ref }}')
    expect(workflow).toContain('HEAD_REPOSITORY: ${{ github.event.pull_request.head.repo.full_name }}')
    expect(workflow).toContain('BASE_REPOSITORY: ${{ github.repository }}')
    expect(workflow).toContain('test "$HEAD_REPOSITORY" = "$BASE_REPOSITORY"')
    expect(workflow).toContain('test "$HEAD_REF" = "dev"')
  })
})
