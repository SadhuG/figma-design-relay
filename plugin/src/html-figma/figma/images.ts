import { getImageFills } from "../utils";

export async function processImages(layer: RectangleNode | TextNode) {
  const images = getImageFills(layer);
  return (
    images &&
    Promise.all(
      images.map(async (image: any) => {
        if (image && image.intArr) {
          image.imageHash = figma.createImage(new Uint8Array(image.intArr)).hash;
          delete image.intArr;
        }
      })
    )
  );
}
