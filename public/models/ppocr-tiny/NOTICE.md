# PP-OCRv6 tiny recognizer

Copyright (c) PaddlePaddle Authors. Distributed under Apache-2.0; see LICENSE.

Source: https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx
Frozen revision: 2612ab37152ae0a677521bae4e1e3d4fb4cf7c30.

inference.onnx and inference.yml are unmodified official files. dictionary.json
is derived from inference.yml's character_dict, adding the CTC blank at index 0
and a trailing space token. This derived file was created by NCE Fighter.
Only English printed text is registered in this application. No detector model
is downloaded or executed. Input is BGR float32 [1,3,48,W]; output uses the
configured CTCLabelDecode vocabulary with 6906 classes.
