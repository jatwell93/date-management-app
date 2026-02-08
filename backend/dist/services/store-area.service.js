"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreAreaService = void 0;
const database_factory_1 = require("../database/database-factory");
class StoreAreaService {
    /**
     * Constructor with optional dependency injection
     * @param prismaClient - Optional PrismaClient for testing/custom configurations
     */
    constructor(prismaClient) {
        this.prisma = prismaClient ?? (0, database_factory_1.getDefaultDatabaseClient)();
    }
    async getAllStoreAreas() {
        const results = await this.prisma.storeArea.findMany({
            orderBy: { name: 'asc' },
        });
        return results.map(this.mapPrismaToModel);
    }
    async getStoreAreaById(id) {
        const result = await this.prisma.storeArea.findUnique({
            where: { id },
        });
        return result ? this.mapPrismaToModel(result) : null;
    }
    async getStoreAreaByName(name) {
        const results = await this.prisma.storeArea.findMany({
            where: { name },
        });
        return results.map(this.mapPrismaToModel);
    }
    async getStoreAreaByNameAndSubDepartment(name, subDepartment) {
        const result = await this.prisma.storeArea.findFirst({
            where: {
                name,
                subDepartment: subDepartment ?? null,
            },
        });
        return result ? this.mapPrismaToModel(result) : null;
    }
    async createStoreArea(area) {
        // Check if a store area with the same name and subDepartment already exists
        const existingArea = await this.getStoreAreaByNameAndSubDepartment(area.name, area.subDepartment || null);
        if (existingArea) {
            throw new Error('A store area with this name and sub-department combination already exists');
        }
        const newArea = await this.prisma.storeArea.create({
            data: {
                name: area.name,
                subDepartment: area.subDepartment || null,
                lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
            },
        });
        return this.mapPrismaToModel(newArea);
    }
    async updateStoreArea(id, area) {
        if (Object.keys(area).length === 0) {
            return null;
        }
        try {
            const updatedArea = await this.prisma.storeArea.update({
                where: { id },
                data: {
                    ...(area.name !== undefined && { name: area.name }),
                    ...(area.subDepartment !== undefined && { subDepartment: area.subDepartment || null }),
                    ...(area.lastChecked !== undefined && {
                        lastChecked: area.lastChecked ? new Date(area.lastChecked) : null,
                    }),
                },
            });
            return this.mapPrismaToModel(updatedArea);
        }
        catch (error) {
            // Prisma throws P2025 when record not found
            if (error.code === 'P2025') {
                return null;
            }
            throw error;
        }
    }
    async deleteStoreArea(id) {
        try {
            await this.prisma.storeArea.delete({
                where: { id },
            });
            return true;
        }
        catch (error) {
            // Prisma throws P2025 when record not found
            if (error.code === 'P2025') {
                return false;
            }
            throw error;
        }
    }
    /**
     * Map Prisma model to legacy StoreArea interface
     */
    mapPrismaToModel(area) {
        return {
            id: area.id,
            name: area.name,
            subDepartment: area.subDepartment ?? undefined,
            lastChecked: area.lastChecked?.toISOString() ?? undefined,
            createdAt: area.createdAt.toISOString(),
            updatedAt: area.updatedAt.toISOString(),
        };
    }
}
exports.StoreAreaService = StoreAreaService;
