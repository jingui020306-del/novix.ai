import type { ChangeEvent, RefObject } from 'react'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

type ProjectSummary = {
  id: string
  title?: string
}

type ProjectSwitcherCardProps = {
  projects: ProjectSummary[]
  selectedProjectId: string
  importInputRef: RefObject<HTMLInputElement>
  onSelectProject: (projectId: string) => void
  onCreateProject: () => void
  onDownloadBackup: () => void
  onDownloadManuscript: () => void
  onImportBackup: (event: ChangeEvent<HTMLInputElement>) => void
}

export function ProjectSwitcherCard({
  projects,
  selectedProjectId,
  importInputRef,
  onSelectProject,
  onCreateProject,
  onDownloadBackup,
  onDownloadManuscript,
  onImportBackup,
}: ProjectSwitcherCardProps) {
  return (
    <Card title='项目'>
      <div className='space-y-2'>
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => onSelectProject(project.id)}
            className={`w-full rounded-ui border px-3 py-2 text-left ${selectedProjectId === project.id ? 'border-brand-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-border bg-surface hover:bg-surface-2'}`}
          >
            <div className='text-sm font-medium'>{project.id}</div>
            <div className='text-xs text-muted'>{project.title}</div>
          </button>
        ))}
        <div className='flex flex-wrap gap-2'>
          <Button variant='primary' onClick={onCreateProject}>Create</Button>
          <Button onClick={onDownloadBackup}>导出备份</Button>
          <Button onClick={onDownloadManuscript}>导出正文</Button>
          <Button onClick={() => importInputRef.current?.click()}>导入备份</Button>
        </div>
        <input ref={importInputRef} className='hidden' type='file' accept='.zip,application/zip' onChange={onImportBackup} />
        <div className='text-xs text-muted'>备份用于恢复全项目；正文 Markdown 用于投稿、迁移和直接阅读。</div>
      </div>
    </Card>
  )
}
