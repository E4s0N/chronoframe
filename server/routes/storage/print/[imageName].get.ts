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
    // 图片不存在，检查原始图片是否存在
    // 修复：原始图片应该在photos子目录中
    const originalFilePath = path.resolve(basePath, 'photos', imageName)
    console.log('Original image path:', originalFilePath)
    
    try {
      await fs.access(originalFilePath)
      
      // 原始图片存在，添加队列任务来生成带有水印的图片
      const queueManager = QueueManager.getInstance()
      
      // 查找照片的数据库记录以获取location_name等信息
      // 修复：数据库中的storageKey应该包含photos/前缀
      const db = useDB()
      let photo = null
      
      try {
        photo = await db.select().from(tables.photos)
          .where(eq(tables.photos.storageKey, `photos/${imageName}`))
          .get()
      } catch (dbError) {
        console.log('Database query error:', dbError)
      }
      
      // 添加队列任务
      // 修复：使用正确的storageKey格式
      await queueManager.addTask({
        type: 'print-photo',
        storageKey: `photos/${imageName}`,
        photoId: photo?.id,
        locationName: photo?.locationName || '',
      }, {
        priority: 5,
        maxAttempts: 3,
        status: 'pending',
      })
      
      // 返回404状态码，让客户端知道图片正在生成
      throw createError({ statusCode: 404, statusMessage: 'Image is being processed. Please try again later.' })
    } catch (originalError) {
      // 原始图片也不存在
      console.log('Original image not found:', originalError)
      throw createError({ statusCode: 404, statusMessage: 'Image not found' })
    }
  }
})
