import { eq } from 'drizzle-orm'

export default eventHandler(async (event) => {
  const photoId = getRouterParam(event, 'photoId')
  
  // 获取当前照片状态
  const photo = await useDB()
    .select()
    .from(tables.photos)
    .where(eq(tables.photos.id, photoId))
    .get()
  
  if (!photo) {
    throw createError({
      statusCode: 404,
      message: 'Photo not found',
    })
  }

  // 切换show状态
  const updatedPhoto = await useDB()
    .update(tables.photos)
    .set({ show: !photo.show })
    .where(eq(tables.photos.id, photoId))
    .returning()
    .get()

  return {
    success: true,
    photo: updatedPhoto,
  }
})