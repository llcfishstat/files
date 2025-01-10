import { registerAs } from '@nestjs/config';

export default registerAs(
  'aws',
  (): Record<string, any> => ({
    region: process.env.S3_REGION,
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    presignExpire: process.env.S3_PRESIGN_EXPIRE,
  }),
);
