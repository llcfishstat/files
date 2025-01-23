import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, retry, timeout } from 'rxjs';
import { ClientProxy } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';

import { PrismaService } from '../../../common/services/prisma.service';
import { IFileService } from '../interfaces/file.service.interface';
import { GetPresignPutObjectDto } from '../dtos/file.presign.put.dto';
import { GetPresignPutObjectResponseDto } from '../dtos/file.presign.put.response.dto';
import { GetPresignGetObjectResponseDto } from '../dtos/file.presign.get.response.dto';
import { CreateFileDto } from '../dtos/file.create.dto';
import { FileResponseDto } from '../dtos/file.response.dto';
import { UserResponseDto } from '../dtos/user.response.dto';
import { IAuthUser } from '../interfaces/file.interface';

@Injectable()
export class FilesService implements IFileService {
  public s3Client: S3Client;
  constructor(
    @Inject('AUTH_SERVICE') private readonly authClient: ClientProxy,
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    this.authClient.connect();
    this.s3Client = new S3Client({
      region: this.configService.get('aws.region'),
      endpoint: this.configService.get('aws.endpoint'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.configService.get('aws.accessKeyId'),
        secretAccessKey: this.configService.get('aws.secretAccessKey'),
      },
    });
  }

  async createFile(
    userId: string,
    data: CreateFileDto,
  ): Promise<FileResponseDto> {
    const { fileName, fileType, storageKey } = data;

    const file = await this.prismaService.files.create({
      data: {
        fileName,
        fileType,
        storageKey,
        userId,
      },
    });
    try {
      const userResponse = await firstValueFrom(
        this.authClient
          .send('getUserById', JSON.stringify({ userId }))
          .pipe(timeout(5000), retry(3)),
      );
      const user = plainToInstance(UserResponseDto, userResponse);
      return { ...file, author: user };
    } catch (error) {
      throw new Error(
        `Failed to retrieve user with ID ${userId}: ${error.message}`,
      );
    }
  }

  async getPresignPutObject(
    { fileName, contentType }: GetPresignPutObjectDto,
    { id: userId }: IAuthUser,
  ): Promise<GetPresignPutObjectResponseDto> {
    try {
      const storageKey = `${userId}/${Date.now()}_${fileName}`;
      const command = new PutObjectCommand({
        Bucket: this.configService.get('aws.bucket'),
        Key: storageKey,
        ContentType: contentType,
      });
      console.log('Bucket:', this.configService.get('aws.bucket'));
      console.log('Storage Key:', storageKey);
      console.log('Content Type:', contentType);

      try {
        const url = await getSignedUrl(this.s3Client, command, {
          expiresIn: Number(this.configService.get('aws.presignExpire')),
        });
        console.log('Generated URL:', url);
        return { url, storageKey };
      } catch (e) {
        console.error('Error generating presigned URL:', e);
        throw e;
      }
    } catch (e) {
      console.error('Error generating presigned URL:', e.message, e.stack);
      throw e;
    }
  }

  async getPresignGetObject(
    fileId: string,
  ): Promise<GetPresignGetObjectResponseDto> {
    try {
      const file = await this.prismaService.files.findUnique({
        where: {
          id: fileId,
        },
      });
      if (!file) {
        throw new NotFoundException('file.fileNotFound');
      }
      const command = new GetObjectCommand({
        Bucket: this.configService.get('aws.bucket'),
        Key: file.storageKey,
        ResponseContentDisposition: 'inline',
      });
      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: Number(this.configService.get('aws.presignExpire')),
      });
      return {
        url,
      };
    } catch (e) {
      throw e;
    }
  }

  async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.prismaService.files.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new NotFoundException('file.fileNotFound');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('Not allowed to delete this file');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.configService.get('aws.bucket'),
      Key: file.storageKey,
    });
    await this.s3Client.send(command);

    await this.prismaService.files.delete({
      where: { id: fileId },
    });
  }
}
