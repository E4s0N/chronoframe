import path from 'node:path'
import { createReadStream, promises as fs } from 'node:fs'
import { getStorageManager } from '~~/server/plugins/3.storage'
import { QueueManager } from '~~/server/services/pipeline-queue/manager'
import { useDB, tables } from '~~/server/utils/db'
import { eq } from 'drizzle-orm'

// 简单的Content-Type猜测函数
const guessContentType = (filePath: string): string => {
  const ext = (filePath.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

export default defineEventHandler(async (event) => {
  const imageName = getRouterParam(event, 'imageName')
  if (!imageName) {
    throw createError({ statusCode: 400, statusMessage: 'Image name is required' })
  }

  // 检查图片名称是否有效（防止路径穿越）
  if (imageName.includes('..') || imageName.includes('/') || imageName.includes('\\')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid image name' })
  }

  const manager = getStorageManager()
  const provider = manager.getProvider()

  if ((provider as any).config?.provider !== 'local') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const basePath = (provider as any).config.basePath as string
  const printPath = path.resolve(basePath, 'photos/print')
  const printFilePath = path.resolve(printPath, imageName)
  
  try {
    // 检查print目录中是否存在该图片
    await fs.access(printFilePath)
    
    // 存在则返回图片
    const stat = await fs.stat(printFilePath)
    setHeader(event, 'Content-Type', guessContentType(printFilePath))
    setHeader(event, 'Content-Length', stat.size)
    setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
    
    return sendStream(event, createReadStream(printFilePath))
  } catch (error) {
    // 图片不存在，直接返回404，因为现在会在上传时自动生成打印图片
    throw createError({ statusCode: 404, statusMessage: 'Print image not found. It may still be processing or the source image does not exist.' })
  }
})
