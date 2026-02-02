import { eq, inArray } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const body = await readBody(event)
  const { photoIds, show } = body
  
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'Photo IDs array is required and cannot be empty',
    })
  }
  
  if (typeof show !== 'boolean') {
    throw createError({
      statusCode: 400,
      message: 'Show property is required and must be a boolean',
    })
  }

  // 更新多个照片的显示状态
  const updatedPhotos = await useDB()
    .update(tables.photos)
    .set({ show })
    .where(inArray(tables.photos.id, photoIds))
    .returning()

  return {
    success: true,
    updatedCount: updatedPhotos.length,
  }
})