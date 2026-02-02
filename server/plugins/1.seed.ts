import { eq, isNull } from 'drizzle-orm'

export default defineNitroPlugin(async () => {
  // 确保现有的照片都有show字段设置为true
  try {
    const photosWithoutShow = await useDB()
      .select()
      .from(tables.photos)
      .where(isNull(tables.photos.show))
      .all()

    if (photosWithoutShow.length > 0) {
      console.log(`Updating ${photosWithoutShow.length} photos to set show=true`)
      
      for (const photo of photosWithoutShow) {
        await useDB()
          .update(tables.photos)
          .set({ show: true })
          .where(eq(tables.photos.id, photo.id))
          .run()
      }
      
      console.log('Updated photos with show=true')
    }
  } catch (error) {
    console.error('Error updating photos with show field:', error)
  }
})