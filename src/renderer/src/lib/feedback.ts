// Where users ask questions and report bugs: the project's GitHub Discussions and Issues.

import { RELEASES_REPO } from '../../../shared/update'

const REPO = `https://github.com/${RELEASES_REPO}`
export const DISCUSSIONS_URL = `${REPO}/discussions`
export const IDEAS_URL = `${REPO}/discussions/new?category=ideas`

const platform = () => (/Mac/.test(navigator.platform) ? 'macOS' : /Linux/.test(navigator.platform) ? 'Linux' : 'Windows')

/** A new bug report with the version, the platform and, when known, the error filled in. */
export async function bugReportUrl(error?: string): Promise<string> {
  const version = (await window.api.update.status().catch(() => null))?.current ?? '?'
  const body = [
    `**Canopus:** ${version}`,
    `**Platform:** ${platform()}`,
    '',
    '**What happened / Что произошло:**',
    '',
    '**Steps / Шаги:**',
    '1. ',
    ...(error ? ['', '**Error / Ошибка:**', '```', error.slice(0, 1500), '```'] : [])
  ].join('\n')
  const params = new URLSearchParams({ template: 'bug_report.md', labels: 'bug', title: error ? `Error: ${error.slice(0, 80)}` : '', body })
  return `${REPO}/issues/new?${params}`
}

/** A report of a number that differs from the game: the inaccuracy template, with the version filled in. */
export async function inaccuracyReportUrl(): Promise<string> {
  const version = (await window.api.update.status().catch(() => null))?.current ?? '?'
  const params = new URLSearchParams({ template: 'inaccuracy.md', labels: 'inaccuracy', title: 'Inaccuracy: ' })
  const body = [
    `**Canopus:** ${version}`,
    `**Platform:** ${platform()}`,
    '**Where / Где:** ',
    '',
    '**Fit or item (EFT for fits) / Фит или предмет (фит в формате EFT):**',
    '```',
    '',
    '```',
    '',
    '**Skills / Навыки:** ',
    '',
    '**What the game shows / Что показывает игра:**',
    '',
    '**What Canopus shows / Что показывает Canopus:**',
    '',
    '**Pyfa, if you checked / Pyfa, если проверяли:**'
  ].join('\n')
  params.set('body', body)
  return `${REPO}/issues/new?${params}`
}

export const reportInaccuracy = () => void inaccuracyReportUrl().then((u) => window.api.openExternal(u))
export const openDiscussions = () => void window.api.openExternal(DISCUSSIONS_URL)
export const openIdeas = () => void window.api.openExternal(IDEAS_URL)
export const reportBug = (error?: string) => void bugReportUrl(error).then((u) => window.api.openExternal(u))
