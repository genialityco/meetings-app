import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/firebaseConfig";

export async function uploadCompanyLogo(
  eventId: string,
  nitNorm: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop() || "png";
  const storageRef = ref(storage, `companies/${eventId}/${nitNorm}/logo.${ext}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}
