import { prisma } from "@/lib/api/db";
import { CollectionIncludingMembersAndLinkCount } from "@/types/global";
import createFolder from "@/lib/api/storage/createFolder";

export default async function postCollection(
  collection: CollectionIncludingMembersAndLinkCount,
  userId: number
) {
  if (!collection || collection.name.trim() === "")
    return {
      response: "Please enter a valid collection.",
      status: 400,
    };

  if (collection.parentId) {
    const findParentCollection = await prisma.collection.findUnique({
      where: {
        id: collection.parentId,
      },
      select: {
        ownerId: true,
      },
    });

    if (
      findParentCollection?.ownerId !== userId ||
      typeof collection.parentId !== "number"
    )
      return {
        response: "You are not authorized to create a sub-collection here.",
        status: 403,
      };
  }

  const findCollection = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      collections: {
        where: {
          name: collection.name,
        },
      },
    },
  });

  const checkIfCollectionExists = findCollection?.collections[0];

  if (checkIfCollectionExists)
    return {
      response: "Oops! There's already a Collection with that name.",
      status: 400,
    };

  const newCollection = await prisma.collection.create({
    data: {
      owner: {
        connect: {
          id: userId,
        },
      },
      name: collection.name.trim(),
      description: collection.description,
      color: collection.color,
      parent: collection.parentId
        ? {
            connect: {
              id: collection.parentId,
            },
          }
        : undefined,
    },
    include: {
      _count: {
        select: { links: true },
      },
      members: {
        include: {
          user: {
            select: {
              username: true,
              name: true,
            },
          },
        },
      },
    },
  });

  createFolder({ filePath: `archives/${newCollection.id}` });

  return { response: newCollection, status: 200 };
}
