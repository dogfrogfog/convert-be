import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import sharp from "sharp";

const app = new Hono().basePath("/api");

console.log("🚀 Starting image conversion server...");

// Add CORS middleware
app.use(
  "/*",
  cors({
    origin: "http://localhost:3000",
    allowMethods: ["POST"],
    allowHeaders: ["Content-Type"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

console.log("✅ CORS middleware configured for localhost:3000");

// Define supported formats and their MIME types
const SUPPORTED_FORMATS = {
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

// Validate file type with better error handling
function isValidImageType(file: File): boolean {
  return (
    file.type.startsWith("image/") &&
    Object.values(SUPPORTED_FORMATS).includes(file.type as any)
  );
}

// Enhanced conversion function with error handling
async function convertImage(
  buffer: Buffer,
  format: string,
  options: {
    quality?: number;
    lossless?: boolean;
  } = {}
): Promise<Buffer> {
  const sharpInstance = sharp(buffer);

  try {
    // Get image metadata
    const metadata = await sharpInstance.metadata();
    if (!metadata) {
      throw new Error("Could not read image metadata");
    }

    // Set default quality
    const quality = options.quality || 80;

    switch (format.toLowerCase()) {
      case "webp":
        return await sharpInstance
          .webp({
            quality,
            lossless: options.lossless,
          })
          .toBuffer();

      case "avif":
        return await sharpInstance
          .avif({
            quality,
            lossless: options.lossless,
          })
          .toBuffer();

      case "jpg":
      case "jpeg":
        return await sharpInstance
          .jpeg({
            quality,
            mozjpeg: true,
          })
          .toBuffer();

      case "png":
        return await sharpInstance
          .png({
            quality,
            compressionLevel: 9,
          })
          .toBuffer();

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  } catch (err) {
    const error = err as Error;
    console.error("Conversion error:", error);
    throw new Error(`Failed to convert to ${format}: ${error.message}`);
  }
}

app.post("/upload", async (c) => {
  try {
    console.log("📥 Received new upload request");
    const formData = await c.req.formData();
    const files = formData.getAll("files") as File[];
    const targetFormat = formData.get("targetFormat") as string;
    const quality = Number(formData.get("quality")) || 80;
    const lossless = formData.get("lossless") === "true";

    console.log(`🎯 Converting ${files.length} file(s) to ${targetFormat}`);
    console.log(`⚙️  Quality: ${quality}, Lossless: ${lossless}`);

    // Validate request
    if (!files || files.length === 0) {
      return c.json({ error: "No files provided" }, { status: 400 });
    }

    if (!Object.keys(SUPPORTED_FORMATS).includes(targetFormat)) {
      return c.json({ error: "Unsupported format" }, { status: 400 });
    }

    // Process each file
    const convertedFiles = await Promise.all(
      files.map(async (file) => {
        console.log(`\n🔄 Processing: ${file.name}`);
        // Validate file type
        if (!isValidImageType(file)) {
          throw new Error(`Invalid file type: ${file.name}`);
        }

        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Get original image info
          const originalInfo = await sharp(buffer).metadata();
          if (!originalInfo) {
            throw new Error("Could not read original image metadata");
          }

          // Convert image with options
          const convertedBuffer = await convertImage(buffer, targetFormat, {
            quality,
            lossless,
          });

          // Get converted image info
          const convertedInfo = await sharp(convertedBuffer).metadata();
          if (!convertedInfo) {
            throw new Error("Could not read converted image metadata");
          }

          console.log(`✨ Successfully converted: ${file.name}`);
          return {
            name: `${file.name.split(".")[0]}.${targetFormat.toLowerCase()}`,
            buffer: convertedBuffer.toString("base64"),
            originalName: file.name,
            size: convertedBuffer.length,
            type: SUPPORTED_FORMATS[
              targetFormat as keyof typeof SUPPORTED_FORMATS
            ],
            metadata: {
              original: {
                format: originalInfo.format,
                width: originalInfo.width,
                height: originalInfo.height,
                size: buffer.length,
              },
              converted: {
                format: convertedInfo.format,
                width: convertedInfo.width,
                height: convertedInfo.height,
                size: convertedBuffer.length,
              },
            },
          };
        } catch (err) {
          const error = err as Error;
          console.error(`Error converting ${file.name}:`, error);
          throw new Error(`Failed to convert ${file.name}: ${error.message}`);
        }
      })
    );

    console.log(`\n✅ All files converted successfully!`);
    return c.json({
      message: "Files converted successfully",
      files: convertedFiles,
    });
  } catch (err) {
    const error = err as Error;
    console.error("❌ Error processing files:", error);
    return c.json(
      {
        error: "Error processing files",
        details: error.message,
      },
      { status: 500 }
    );
  }
});

serve({
  fetch: app.fetch,
  port: 4444,
  // onListen: ({ port }) => {
  // console.log(`\n🌍 Server is running on http://localhost:${port}`);
  // console.log("📁 API endpoint: http://localhost:4444/api/upload");
  // },
});
