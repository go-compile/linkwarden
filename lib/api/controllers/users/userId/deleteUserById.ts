import { prisma } from "@/lib/api/db";
import bcrypt from "bcrypt";
import removeFolder from "@/lib/api/storage/removeFolder";
import Stripe from "stripe";

type DeleteUserBody = {
  password: string;
  cancellation_details?: {
    comment?: string;
    feedback?: Stripe.SubscriptionCancelParams.CancellationDetails.Feedback;
  };
};

export default async function deleteUserById(
  userId: number,
  body: DeleteUserBody
) {
  // First, we retrieve the user from the database
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return {
      response: "User not found.",
      status: 404,
    };
  }

  // Then, we check if the provided password matches the one stored in the database
  const isPasswordValid = bcrypt.compareSync(body.password, user.password);

  if (!isPasswordValid) {
    return {
      response: "Invalid password.",
      status: 401, // Unauthorized
    };
  }

  // Delete the user and all related data within a transaction
  await prisma.$transaction(async (prisma) => {
    // Delete whitelisted users
    await prisma.whitelistedUser.deleteMany({
      where: { userId },
    });

    // Delete links
    await prisma.link.deleteMany({
      where: { collection: { ownerId: userId } },
    });

    // Delete tags
    await prisma.tag.deleteMany({
      where: { ownerId: userId },
    });

    // Delete collections
    const collections = await prisma.collection.findMany({
      where: { ownerId: userId },
    });

    for (const collection of collections) {
      // Delete related users and collections relations
      await prisma.usersAndCollections.deleteMany({
        where: { collectionId: collection.id },
      });

      // Optionally delete archive folders associated with collections
      removeFolder({ filePath: `archives/${collection.id}` });
    }

    // Delete collections after cleaning up related data
    await prisma.collection.deleteMany({
      where: { ownerId: userId },
    });

    // Optionally delete user's avatar
    removeFolder({ filePath: `uploads/avatar/${userId}.jpg` });

    // Finally, delete the user
    await prisma.user.delete({
      where: { id: userId },
    });
  });

  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2022-11-15",
    });

    const listByEmail = await stripe.customers.list({
      email: user.email?.toLowerCase(),
      expand: ["data.subscriptions"],
    });

    if (listByEmail.data[0].subscriptions?.data[0].id) {
      const deleted = await stripe.subscriptions.cancel(
        listByEmail.data[0].subscriptions?.data[0].id,
        {
          cancellation_details: {
            comment: body.cancellation_details?.comment,
            feedback: body.cancellation_details?.feedback,
          },
        }
      );

      return {
        response: deleted,
        status: 200,
      };
    }
  }

  return {
    response: "User account and all related data deleted successfully.",
    status: 200,
  };
}